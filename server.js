/*********************************************************
 * server.js - Add /api/my-appeals route + 2 images
 *********************************************************/
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mongoose = require('mongoose');
const { Client, GatewayIntentBits } = require('discord.js');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

// Mongoose models
const Appeal = require('./appeal.js');
const Report = require('./Report.js');

const app = express();

// 1) Initialize Discord Bot
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// 2) Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('MongoDB connected.');
}).catch((err) => console.error('MongoDB error:', err));

// 3) Express & Passport
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'randomsecret',
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// Discord OAuth
passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_REDIRECT_URI,
  scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
  return done(null, profile);
}));
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// OAuth routes
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => res.redirect('/')
);

// 4) /api/me
app.get('/api/me', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not logged in' });
  }
  res.json({
    id: req.user.id,
    username: req.user.username,
    discriminator: req.user.discriminator,
    avatarUrl: `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png?size=256`
  });
});

// 5) Logout
app.post('/api/logout', (req, res) => {
  req.logout(() => res.json({ message: 'Logged out' }));
});

// 6) GET /api/my-appeals
app.get('/api/my-appeals', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not logged in' });
  }
  Appeal.find({ userId: req.user.id })
    .sort({ timestamp: -1 })
    .then(appeals => {
      res.json(appeals);
    })
    .catch(err => {
      console.error('Fetch my appeals error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    });
});

// 7) POST /api/submit-appeal
app.post('/api/submit-appeal', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'You must be logged in.' });
    }
    const {
      punishmentType,
      punishmentReason,
      appealReason,
      additionalInfo,
      screenshotLinks // array of 0-2 URLs from the frontend
    } = req.body;

    if (!punishmentType || !punishmentReason || !appealReason) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    // Check if user has a Pending appeal
    const existingPending = await Appeal.findOne({
      userId: req.user.id,
      status: 'Pending'
    });
    if (existingPending) {
      return res.status(400).json({ message: 'You already have a pending appeal.' });
    }

    // Check if user has a Rejected <7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentRejected = await Appeal.findOne({
      userId: req.user.id,
      status: 'Rejected',
      responseTimestamp: { $gte: sevenDaysAgo }
    });
    if (recentRejected) {
      return res.status(400).json({
        message: 'You have a rejected appeal within the last 7 days. Please wait before appealing again.'
      });
    }

    // Generate random 4-digit ID
    let newId;
    let unique = false;
    while (!unique) {
      newId = (Math.floor(Math.random() * 9000) + 1000).toString();
      const existing = await Appeal.findOne({ appealId: newId });
      if (!existing) unique = true;
    }

    // Save to DB
    const doc = new Appeal({
      appealId: newId,
      userId: req.user.id,
      userTag: `${req.user.username}#${req.user.discriminator}`,
      muteOrBan: punishmentType,
      punishmentReason,
      revokeReason: appealReason,
      additionalConsiderations: additionalInfo || '',
      status: 'Pending',
      timestamp: new Date()
    });
    await doc.save();

    // Build embed
    const channel = client.channels.cache.get(process.env.APPEAL_CHANNEL_ID);
    if (!channel) {
      return res.status(500).json({ message: 'Appeal channel not found.' });
    }

    const userAvatarUrl = `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png?size=128`;
    const embed = new EmbedBuilder()
      .setTitle('New Appeal Submitted')
      .setAuthor({
        name: `${req.user.username}#${req.user.discriminator}`,
        iconURL: userAvatarUrl
      })
      .setColor(0x00AE86) // "Pending"
      .addFields(
        { name: 'Appeal ID', value: `\`${newId}\``, inline: true },
        {
          name: 'User',
          value: `<@${req.user.id}> (${req.user.username}#${req.user.discriminator})`,
          inline: true
        },
        { name: 'Muted/Banned', value: punishmentType, inline: true },
        { name: 'Punishment Reason', value: punishmentReason, inline: false },
        { name: 'Reason to Revoke', value: appealReason, inline: false },
        {
          name: 'Additional Considerations',
          value: additionalInfo && additionalInfo.trim() !== '' ? additionalInfo : 'None',
          inline: false
        },
        {
          name: 'Submitted At',
          value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
          inline: false
        }
      )
      .setTimestamp();

    // If screenshotLinks exist, add them to embed
    if (Array.isArray(screenshotLinks)) {
      screenshotLinks.forEach((link, index) => {
        embed.addFields({
          name: `Screenshot #${index + 1}`,
          value: `[View Screenshot](${link})`,
          inline: false
        });
      });
    }

    // Buttons
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`approve_${newId}`)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`reject_${newId}`)
        .setLabel('Reject')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`history_${req.user.id}`)
        .setLabel('View History')
        .setStyle(ButtonStyle.Primary)
    );

    const appealMsg = await channel.send({
      embeds: [embed],
      components: [row]
    });

    // Create a public thread
    const threadName = `${req.user.username}'s Appeal`;
    try {
      await appealMsg.startThread({
        name: threadName,
        autoArchiveDuration: 1440,
        type: 'GUILD_PUBLIC_THREAD',
        reason: `Thread for Appeal ID ${newId}`
      });
    } catch (threadErr) {
      console.error(`Failed to create thread for #${newId}:`, threadErr);
    }

    return res.json({ message: 'Appeal submitted successfully.' });
  } catch (err) {
    console.error('submit-appeal error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// 8) Serve static front-end
app.use(express.static(__dirname));

// 9) Start Express
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Express server on port ${PORT}`));

// 10) Bot login
client.on('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

// 11) indefinite usage: Approve/Reject + "View History"
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  try {
    await interaction.deferUpdate(); // indefinite
  } catch (err) {
    console.warn('Interaction invalid or expired:', err.message);
    return;
  }

  const customId = interaction.customId;
  if (customId.startsWith('approve_') || customId.startsWith('reject_')) {
    const [action, appealId] = customId.split('_');
    const appealDoc = await Appeal.findOne({ appealId });
    if (!appealDoc) return;

    if (appealDoc.status !== 'Pending') return;

    const newStatus = (action === 'approve') ? 'Approved' : 'Rejected';
    appealDoc.status = newStatus;
    appealDoc.moderatorId = interaction.user.id;
    appealDoc.moderatorTag = interaction.user.tag;
    appealDoc.responseTimestamp = new Date();
    await appealDoc.save();

    // DM user
    try {
      const user = await client.users.fetch(appealDoc.userId);
      await user.send(`Hello! Your appeal (#${appealId}) has been **${newStatus}**.`);
    } catch (dmErr) {
      console.warn('Failed to DM user:', dmErr.message);
    }

    const oldMsg = await interaction.channel.messages.fetch(interaction.message.id);
    if (!oldMsg) return;
    const oldEmbed = oldMsg.embeds[0];
    if (!oldEmbed) return;

    const color = newStatus === 'Approved' ? 0x90EE90 : 0xFFB6C1;
    const statusMsg = (newStatus === 'Approved')
      ? 'The appeal has been **approved**.'
      : 'The appeal has been **rejected**.';
    const updatedEmbed = EmbedBuilder.from(oldEmbed)
      .setColor(color)
      .addFields(
        { name: 'Status', value: `\`${newStatus}\``, inline: true },
        { name: 'Moderator', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
        { name: 'Responded At', value: appealDoc.responseTimestamp.toLocaleString(), inline: false }
      );

    await oldMsg.edit({ content: statusMsg, embeds: [updatedEmbed], components: [] });
  }

  // "history_USERID"
  if (customId.startsWith('history_')) {
    const userId = customId.split('_')[1];
    try {
      const userReports = await Report.find({
        authorId: userId,
        status: { $regex: /^Action Taken:/i }
      }).sort({ timestamp: -1 });

      if (!userReports || userReports.length === 0) {
        await interaction.followUp({ content: 'No previous violations found.', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`Previous Violations for <@${userId}>`)
        .setColor(0x5865F2)
        .setTimestamp();

      const maxReports = 10;
      const limited = userReports.slice(0, maxReports);

      limited.forEach(r => {
        embed.addFields({
          name: `Case #${r.caseId} - ${new Date(r.timestamp).toLocaleDateString()}`,
          value: [
            `**Action:** ${r.status.replace('Action Taken:', '')}`,
            `**Reason:** ${r.reason || 'No reason'}`,
            `**Moderator:** ${r.actionTakenByName || 'Unknown'}`
          ].join('\n'),
          inline: false
        });
      });

      if (userReports.length > maxReports) {
        embed.addFields({
          name: 'Note',
          value: `Showing only ${maxReports} of ${userReports.length} total.`,
          inline: false
        });
      }

      await interaction.followUp({ embeds: [embed], ephemeral: true });
    } catch (err) {
      console.error('View History error:', err);
      await interaction.followUp({ content: 'Error fetching violation history.', ephemeral: true });
    }
  }
});

// 12) Bot login
client.login(process.env.DISCORD_BOT_TOKEN);
