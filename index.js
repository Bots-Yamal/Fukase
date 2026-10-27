const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  SlashCommandBuilder
} = require("discord.js");

const fs = require("fs");
const http = require("http");

const PREFIX = "b!";
const DATA_FILE = "./welcome-config.json";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildInvites
  ]
});

// ======================================================
// BASE DE DATOS JSON
// ======================================================

let data = {};

if (fs.existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    data = {};
  }
}

const defaults = () => ({
  welcomeChannel: null,
  autoRole: null,
  logsChannel: null,
  inviteChannel: null,

  autoReplies: {},
  autoReactions: {},
  warnings: {},

  maintenance: false,

  inviteUsers: {},
  memberInviters: {},

  giveaways: {},

  // NUEVO: CONTADOR DE MENSAJES PARA REQUISITOS
  messageCounts: {},

  // NUEVO: SISTEMA DE ROLES INTERACTIVOS
  reactionRoles: {}
});

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Error guardando datos:", error);
  }
}

function getGuildData(id) {
  if (!data[id]) {
    data[id] = defaults();
    saveData();
  }

  const def = defaults();

  for (const key of Object.keys(def)) {
    if (data[id][key] === undefined) {
      data[id][key] = def[key];
    }
  }

  return data[id];
}

// ======================================================
// UTILIDADES
// ======================================================

function isAdmin(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

async function adminOnlyMessage(message) {
  if (isAdmin(message.member)) return true;

  await message.reply(
    "🚫 Solo los administradores pueden usar los comandos de Fusake."
  ).catch(() => {});

  return false;
}

async function adminOnlyInteraction(interaction) {
  if (isAdmin(interaction.member)) return true;

  await interaction.reply({
    content: "🚫 Solo los administradores pueden usar este comando.",
    ephemeral: true
  }).catch(() => {});

  return false;
}

const mentionedMember = message => message.mentions.members.first();
const mentionedRole = message => message.mentions.roles.first();
const mentionedChannel = message => message.mentions.channels.first();

function duration(ms) {
  const s = Math.floor(ms / 1000);

  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;

  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || !parts.length) parts.push(`${seconds}s`);

  return parts.join(" ");
}

function parseDuration(input) {
  if (!input) return null;

  const clean = input.toLowerCase().replace(/\s+/g, "");

  const regex = /(\d+)(d|h|m|s)/g;

  let total = 0;
  let match;
  let matched = "";

  while ((match = regex.exec(clean)) !== null) {
    const amount = Number(match[1]);
    const unit = match[2];

    matched += match[0];

    if (unit === "d") total += amount * 86400000;
    if (unit === "h") total += amount * 3600000;
    if (unit === "m") total += amount * 60000;
    if (unit === "s") total += amount * 1000;
  }

  if (matched !== clean || total <= 0) return null;

  return total;
}

function parseColor(input) {
  if (!input) return null;

  const value = input.replace("#", "");

  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;

  return parseInt(value, 16);
}

function shuffle(array) {
  const arr = [...array];

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

// ======================================================
// NUEVO: REQUISITOS DE SORTEOS
// ======================================================

function parseRequirements(text) {
  const requirements = {
    invites: 0,
    messages: 0,
    raw: text || ""
  };

  if (!text || !text.trim()) {
    return requirements;
  }

  const lower = text.toLowerCase();

  const inviteMatch = lower.match(
    /(\d+)\s*(invite|invites|invitacion|invitación|invitaciones)/
  );

  const messageMatch = lower.match(
    /(\d+)\s*(mensaje|mensajes|message|messages)/
  );

  if (inviteMatch) {
    requirements.invites = Number(inviteMatch[1]);
  }

  if (messageMatch) {
    requirements.messages = Number(messageMatch[1]);
  }

  return requirements;
}

function requirementText(giveaway) {
  const req = giveaway.requirements;

  if (!req || (!req.invites && !req.messages)) {
    return "Ninguno";
  }

  const list = [];

  if (req.invites) {
    list.push(`🔗 **${req.invites} invitaciones**`);
  }

  if (req.messages) {
    list.push(`💬 **${req.messages} mensajes**`);
  }

  return list.join("\n");
}

function getUserInviteCount(guild, userId) {
  const d = getGuildData(guild.id);
  const stats = inviteStats(d, userId);

  return stats.members.filter(id =>
    guild.members.cache.has(id)
  ).length;
}

function getUserMessageCount(guild, userId) {
  const d = getGuildData(guild.id);

  return d.messageCounts[userId] || 0;
}

function checkGiveawayRequirements(guild, userId, giveaway) {
  const requirements = giveaway.requirements || {
    invites: 0,
    messages: 0
  };

  const currentInvites = getUserInviteCount(guild, userId);
  const currentMessages = getUserMessageCount(guild, userId);

  const failed = [];

  if (
    requirements.invites > 0 &&
    currentInvites < requirements.invites
  ) {
    failed.push(
      `🔗 Invitaciones: **${currentInvites}/${requirements.invites}**`
    );
  }

  if (
    requirements.messages > 0 &&
    currentMessages < requirements.messages
  ) {
    failed.push(
      `💬 Mensajes: **${currentMessages}/${requirements.messages}**`
    );
  }

  return {
    ok: failed.length === 0,
    failed,
    currentInvites,
    currentMessages
  };
}

// ======================================================
// NUEVO: ROLES INTERACTIVOS
// ======================================================

function getReactionRolePanel(d, messageId) {
  return d.reactionRoles?.[messageId] || null;
}

function makeReactionRoleComponents(panel) {
  if (!panel || !Array.isArray(panel.options)) {
    return [];
  }

  if (panel.type === "MENU") {
    const options = panel.options.slice(0, 25).map(option => {
      const item = {
        label: option.label.slice(0, 100),
        value: option.roleId,
        description: `Obtener el rol ${option.label}`.slice(0, 100)
      };

      if (option.emoji) {
        item.emoji = option.emoji;
      }

      return item;
    });

    if (!options.length) return [];

    return [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`reacrol_menu:${panel.messageId}`)
          .setPlaceholder("Selecciona un rol...")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(options)
      )
    ];
  }

  if (panel.type === "BOTON") {
    const rows = [];
    const options = panel.options.slice(0, 25);

    for (let i = 0; i < options.length; i += 5) {
      const row = new ActionRowBuilder();

      for (const option of options.slice(i, i + 5)) {
        const button = new ButtonBuilder()
          .setCustomId(
            `reacrol_button:${panel.messageId}:${option.roleId}`
          )
          .setLabel(option.label.slice(0, 80))
          .setStyle(ButtonStyle.Secondary);

        if (option.emoji) {
          button.setEmoji(option.emoji);
        }

        row.addComponents(button);
      }

      rows.push(row);
    }

    return rows;
  }

  return [];
}

async function updateReactionRoleMessage(guild, panel) {
  const channel = guild.channels.cache.get(panel.channelId);

  if (!channel?.isTextBased()) {
    throw new Error("CHANNEL_NOT_FOUND");
  }

  const message = await channel.messages.fetch(panel.messageId);

  const components = makeReactionRoleComponents(panel);

  await message.edit({
    components
  });

  return message;
}

// ======================================================
// LOGS
// ======================================================

async function sendLog(guild, title, description, color = 0x3498db) {
  const d = getGuildData(guild.id);

  if (!d.logsChannel) return;

  const c = guild.channels.cache.get(d.logsChannel);

  if (!c || !c.isTextBased()) return;

  await c.send({
    embeds: [
      new EmbedBuilder()
        .setColor(color)
        .setTitle(`♟️🃏 ${title}`)
        .setDescription(description.slice(0, 4000))
        .setFooter({
          text: "♟️ Fusake • 🃏 Redkings"
        })
        .setTimestamp()
    ]
  }).catch(() => {});
}

// ======================================================
// HELP
// ======================================================

const help = {
  moderacion: [
    "♟️🛡️ MODERACIÓN",
    "b!ban @usuario [razón]",
    "b!unban ID",
    "b!kick @usuario [razón]",
    "b!softban @usuario [razón]",
    "b!timeout @usuario minutos",
    "b!untimeout @usuario",
    "b!warn @usuario [razón]",
    "b!warnings @usuario",
    "b!clearwarnings @usuario",
    "b!purge cantidad",
    "b!clear cantidad",
    "b!slowmode segundos",
    "b!lock",
    "b!unlock",
    "b!lockall",
    "b!unlockall",
    "b!nick @usuario nombre",
    "b!dehoist",
    "b!checkmember @usuario"
  ],

  configuracion: [
    "⚙️ CONFIGURACIÓN",
    "b!bienvenida #canal",
    "b!bienvenida off",
    "b!autoroles @rol",
    "b!clearautorole",
    "b!logs #canal",
    "b!clearlogs",
    "b!invite #canal",
    "b!invite off",
    "b!autorespuestas palabra respuesta",
    "b!autoreacciones palabra emoji",
    "b!delreply palabra",
    "b!delreaction palabra",
    "b!maintenance",
    "b!maintenanceon",
    "b!maintenanceoff",
    "b!config",
    "b!resetconfig",
    "/reacrol"
  ],

  servidor: [
    "🏠 SERVIDOR",
    "b!serverinfo",
    "b!userinfo @usuario",
    "b!roleinfo @rol",
    "b!channelinfo #canal",
    "b!roles",
    "b!members",
    "b!membercount",
    "b!bots",
    "b!humans",
    "b!emojis",
    "b!boosts",
    "b!staff",
    "b!permissions @usuario",
    "b!avatar @usuario",
    "b!servericon",
    "b!serverbanner",
    "b!created",
    "b!channelcount",
    "b!categorycount",
    "b!rolecount",
    "b!memberlist"
  ],

  staff: [
    "🃏🧰 STAFF",
    "b!say mensaje",
    "b!announce mensaje",
    "b!embed #COLOR mensaje",
    "b!poll pregunta",
    "b!move @usuario #voz",
    "b!disconnect @usuario",
    "b!role add @usuario @rol",
    "b!role remove @usuario @rol",
    "b!addrole @usuario @rol",
    "b!removerole @usuario @rol",
    "b!roleall @rol",
    "b!removeroleall @rol",
    "b!setstatus texto",
    "b!clearchannel cantidad",
    "b!renamechannel nombre",
    "b!dm @usuario mensaje",
    "b!react emoji",
    "b!clearlast"
  ],

  sorteos: [
    "🎉 SORTEOS",
    "b!sorteo 1h30m 2 Premio",
    "b!sorteo 1h30m 2 Premio | 5 invites, 1000 mensajes",
    "/sorteo",
    "b!sorteoend ID",
    "/sorteo-end",
    "b!sorteoreroll ID",
    "/sorteo-reroll",
    "",
    "🎉 Participar — disponible para miembros",
    "👥 Ver participantes — disponible para miembros"
  ],

  invitaciones: [
    "🔗 INVITACIONES",
    "b!invite #canal",
    "/invite",
    "b!invites @usuario",
    "/invites",
    "",
    "Nuevas = personas que invitó",
    "Salieron = invitados que abandonaron",
    "En servidor = invitados que siguen dentro"
  ],

  bot: [
    "🤖 BOT",
    "b!help",
    "/help",
    "b!ping",
    "/ping",
    "b!uptime",
    "/uptime",
    "b!botinfo",
    "/botinfo",
    "b!memory",
    "b!serverlist",
    "b!botavatar URL",
    "b!botname nombre",
    "b!restart"
  ]
};

function helpMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("fusake_help")
      .setPlaceholder("♟️🃏 Selecciona una categoría")
      .addOptions([
        {
          label: "Moderación",
          value: "moderacion",
          emoji: "♟️",
          description: "Herramientas de moderación"
        },
        {
          label: "Configuración",
          value: "configuracion",
          emoji: "⚙️",
          description: "Configura Fusake"
        },
        {
          label: "Servidor",
          value: "servidor",
          emoji: "🏠",
          description: "Información del servidor"
        },
        {
          label: "Staff",
          value: "staff",
          emoji: "🃏",
          description: "Herramientas administrativas"
        },
        {
          label: "Sorteos",
          value: "sorteos",
          emoji: "🎉",
          description: "Sistema de sorteos"
        },
        {
          label: "Invitaciones",
          value: "invitaciones",
          emoji: "🔗",
          description: "Sistema de invitaciones"
        },
        {
          label: "Bot",
          value: "bot",
          emoji: "🤖",
          description: "Información de Fusake"
        }
      ])
  );
}

function helpEmbed() {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("♟️🃏 FUSAKE • PANEL ADMINISTRATIVO")
    .setDescription(
      `╔══════════════════════╗
      ♟️ AJEDREZ + PÓKER 🃏
╚══════════════════════╝

**Prefijo:** \`${PREFIX}\`
**Slash commands:** \`/\`

👑 **Panel exclusivo para administradores**

♟️ Mueve tus piezas.
🃏 Juega tus cartas.

Selecciona una categoría en el menú inferior.`
    )
    .setFooter({
      text: "♟️🃏 Fusake • La partida continúa..."
    })
    .setTimestamp();
}

// ======================================================
// INVITACIONES
// ======================================================

const inviteCache = new Map();

async function cacheInvites(guild) {
  try {
    const invites = await guild.invites.fetch();

    inviteCache.set(
      guild.id,
      new Map(
        invites.map(invite => [
          invite.code,
          invite.uses || 0
        ])
      )
    );
  } catch (error) {
    console.log(
      `⚠️ No pude obtener invites de ${guild.name}: ${error.message}`
    );
  }
}

async function detectInvite(guild) {
  const before = inviteCache.get(guild.id) || new Map();

  try {
    const after = await guild.invites.fetch();

    let used = null;

    for (const invite of after.values()) {
      const oldUses = before.get(invite.code) || 0;
      const newUses = invite.uses || 0;

      if (newUses > oldUses) {
        used = invite;
        break;
      }
    }

    inviteCache.set(
      guild.id,
      new Map(
        after.map(invite => [
          invite.code,
          invite.uses || 0
        ])
      )
    );

    return used;
  } catch {
    return null;
  }
}

function inviteStats(d, inviterId) {
  if (!d.inviteUsers[inviterId]) {
    d.inviteUsers[inviterId] = {
      joins: 0,
      leaves: 0,
      members: []
    };
  }

  return d.inviteUsers[inviterId];
}

// ======================================================
// SORTEOS
// ======================================================

function giveawayButtons(id, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway_join:${id}`)
      .setLabel("Participar")
      .setEmoji("🎉")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId(`giveaway_users:${id}`)
      .setLabel("Ver participantes")
      .setEmoji("👥")
      .setStyle(ButtonStyle.Secondary)
  );
}

function giveawayEmbed(giveaway) {
  const endUnix = Math.floor(giveaway.endAt / 1000);

  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🎉🃏 SORTEO • FUSAKE ♟️🎉")
    .setDescription(
      `🏆 **Premio**
${giveaway.prize}

👑 **Ganadores:** ${giveaway.winners}

👥 **Participantes:** ${giveaway.participants.length}

📋 **Requisitos**
${requirementText(giveaway)}

⏰ **Finaliza:** <t:${endUnix}:R>
📅 <t:${endUnix}:F>

🎉 Pulsa **Participar** para entrar al sorteo.`
    )
    .setFooter({
      text: `ID: ${giveaway.id} • ♟️ Fusake 🃏`
    });
}

function selectWinners(giveaway) {
  return shuffle(giveaway.participants)
    .slice(0, Math.min(giveaway.winners, giveaway.participants.length));
}

async function endGiveaway(guild, giveawayId, reroll = false) {
  const d = getGuildData(guild.id);

  const giveaway = d.giveaways[giveawayId];

  if (!giveaway) {
    return {
      ok: false,
      message: "❌ No encontré ese sorteo."
    };
  }

  if (giveaway.ended && !reroll) {
    return {
      ok: false,
      message: "❌ Ese sorteo ya terminó."
    };
  }

  const channel = guild.channels.cache.get(giveaway.channelId);

  if (!channel?.isTextBased()) {
    return {
      ok: false,
      message: "❌ No encontré el canal del sorteo."
    };
  }

  const winners = selectWinners(giveaway);

  if (!reroll) {
    giveaway.ended = true;
    giveaway.lastWinners = winners;
    saveData();

    try {
      const msg = await channel.messages.fetch(giveaway.messageId);

      await msg.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("🎉🃏 SORTEO FINALIZADO")
            .setDescription(
              `🏆 **Premio**
${giveaway.prize}

👑 **Ganadores**
${
  winners.length
    ? winners.map(id => `<@${id}>`).join("\n")
    : "No hubo suficientes participantes."
}

👥 Participantes: **${giveaway.participants.length}**

📋 **Requisitos**
${requirementText(giveaway)}`
            )
            .setFooter({
              text: `ID: ${giveaway.id} • ♟️ Fusake 🃏`
            })
            .setTimestamp()
        ],
        components: [giveawayButtons(giveaway.id, true)]
      });
    } catch {}

    if (winners.length) {
      await channel.send(
        `🎊 ¡Felicidades ${winners.map(id => `<@${id}>`).join(", ")}! Ganaron **${giveaway.prize}**.`
      ).catch(() => {});
    } else {
      await channel.send(
        `🃏 El sorteo **${giveaway.prize}** terminó sin participantes suficientes.`
      ).catch(() => {});
    }
  } else {
    if (!giveaway.ended) {
      return {
        ok: false,
        message: "❌ El sorteo todavía no ha terminado."
      };
    }

    giveaway.lastWinners = winners;
    saveData();

    if (winners.length) {
      await channel.send(
        `🔄🎉 **Nuevos ganadores de ${giveaway.prize}:** ${winners
          .map(id => `<@${id}>`)
          .join(", ")}`
      ).catch(() => {});
    }
  }

  return {
    ok: true,
    winners
  };
}

async function createGiveaway(
  guild,
  channel,
  creatorId,
  time,
  winners,
  prize,
  requirementsText = ""
) {
  if (!time || time < 1000) {
    throw new Error("INVALID_TIME");
  }

  if (!Number.isInteger(winners) || winners < 1 || winners > 50) {
    throw new Error("INVALID_WINNERS");
  }

  if (!prize) {
    throw new Error("INVALID_PRIZE");
  }

  const d = getGuildData(guild.id);

  const id = `${Date.now()}`;

  const giveaway = {
    id,
    guildId: guild.id,
    channelId: channel.id,
    messageId: null,
    creatorId,
    prize,
    winners,
    participants: [],
    requirements: parseRequirements(requirementsText),
    createdAt: Date.now(),
    endAt: Date.now() + time,
    ended: false,
    lastWinners: []
  };

  d.giveaways[id] = giveaway;

  const msg = await channel.send({
    embeds: [giveawayEmbed(giveaway)],
    components: [giveawayButtons(id)]
  });

  giveaway.messageId = msg.id;

  saveData();

  setTimeout(async () => {
    const latest = getGuildData(guild.id).giveaways[id];

    if (latest && !latest.ended) {
      await endGiveaway(guild, id);
    }
  }, time);

  return giveaway;
}

// ======================================================
// SLASH COMMANDS
// ======================================================

const slashCommands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Abre el panel administrativo de Fusake"),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Muestra la latencia del bot"),

  new SlashCommandBuilder()
    .setName("uptime")
    .setDescription("Muestra cuánto tiempo lleva encendido Fusake"),

  new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription("Información de Fusake"),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Envía un embed personalizado")
    .addStringOption(option =>
      option
        .setName("color")
        .setDescription("Color hexadecimal, ejemplo #ff0000")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("mensaje")
        .setDescription("Contenido del embed")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("bienvenida")
    .setDescription("Configura el canal de bienvenida")
    .addChannelOption(option =>
      option
        .setName("canal")
        .setDescription("Canal de bienvenida")
        .addChannelTypes(ChannelType.GuildText)
    )
    .addBooleanOption(option =>
      option
        .setName("desactivar")
        .setDescription("Desactivar las bienvenidas")
    ),

  new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Configura el canal de logs")
    .addChannelOption(option =>
      option
        .setName("canal")
        .setDescription("Canal de logs")
        .addChannelTypes(ChannelType.GuildText)
    )
    .addBooleanOption(option =>
      option
        .setName("desactivar")
        .setDescription("Desactivar los logs")
    ),

  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Configura el autorol")
    .addRoleOption(option =>
      option
        .setName("rol")
        .setDescription("Rol automático")
    )
    .addBooleanOption(option =>
      option
        .setName("desactivar")
        .setDescription("Desactivar el autorol")
    ),

  new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Configura el canal de mensajes de invitaciones")
    .addChannelOption(option =>
      option
        .setName("canal")
        .setDescription("Canal donde aparecerán las nuevas invitaciones")
        .addChannelTypes(ChannelType.GuildText)
    )
    .addBooleanOption(option =>
      option
        .setName("desactivar")
        .setDescription("Desactivar mensajes de invitaciones")
    ),

  new SlashCommandBuilder()
    .setName("invites")
    .setDescription("Muestra las invitaciones de un usuario")
    .addUserOption(option =>
      option
        .setName("usuario")
        .setDescription("Usuario")
        .setRequired(false)
    ),

  // NUEVO REACROL
  new SlashCommandBuilder()
    .setName("reacrol")
    .setDescription("Agrega un rol interactivo a un mensaje")
    .addStringOption(option =>
      option
        .setName("id_mensaje")
        .setDescription("ID del mensaje donde irá el menú o botón")
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName("rol")
        .setDescription("Rol que se otorgará")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("emoji")
        .setDescription("Emoji de la opción")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("tipo")
        .setDescription("Menú o botón")
        .setRequired(true)
        .addChoices(
          {
            name: "Menú",
            value: "MENU"
          },
          {
            name: "Botón",
            value: "BOTON"
          }
        )
    )
    .addStringOption(option =>
      option
        .setName("mensaje")
        .setDescription("Nombre que aparecerá en la opción")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("sorteo")
    .setDescription("Crea un sorteo")
    .addStringOption(option =>
      option
        .setName("tiempo")
        .setDescription("Ejemplo: 1h30m")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("ganadores")
        .setDescription("Cantidad de ganadores")
        .setMinValue(1)
        .setMaxValue(50)
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("premio")
        .setDescription("Premio del sorteo")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("requisitos")
        .setDescription("Ej: 5 invites, 1000 mensajes")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("sorteo-end")
    .setDescription("Finaliza un sorteo")
    .addStringOption(option =>
      option
        .setName("id")
        .setDescription("ID del sorteo")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("sorteo-reroll")
    .setDescription("Elige nuevos ganadores")
    .addStringOption(option =>
      option
        .setName("id")
        .setDescription("ID del sorteo")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Banea un usuario")
    .addUserOption(option =>
      option
        .setName("usuario")
        .setDescription("Usuario")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("razon")
        .setDescription("Razón")
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Expulsa un usuario")
    .addUserOption(option =>
      option
        .setName("usuario")
        .setDescription("Usuario")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("razon")
        .setDescription("Razón")
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Aplica timeout")
    .addUserOption(option =>
      option
        .setName("usuario")
        .setDescription("Usuario")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("minutos")
        .setDescription("Minutos")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Retira un timeout")
    .addUserOption(option =>
      option
        .setName("usuario")
        .setDescription("Usuario")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Elimina mensajes")
    .addIntegerOption(option =>
      option
        .setName("cantidad")
        .setDescription("1-100")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Información del servidor"),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Información de un usuario")
    .addUserOption(option =>
      option
        .setName("usuario")
        .setDescription("Usuario")
    )
].map(command =>
  command
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON()
);

// ======================================================
// READY
// ======================================================

client.once("ready", async () => {
  console.log(`♟️🃏 Fusake conectado como ${client.user.tag}`);
  console.log(`🌐 Servidores: ${client.guilds.cache.size}`);
  console.log(`⚡ Prefijo: ${PREFIX}`);

  client.user.setPresence({
    activities: [
      {
        name: "♟️ Ajedrez + 🃏 Póker",
        type: 0
      }
    ],
    status: "online"
  });

  try {
    await client.application.commands.set(slashCommands);

    console.log("✅ Slash commands registrados.");
  } catch (error) {
    console.error("❌ Error registrando slash commands:", error);
  }

  for (const guild of client.guilds.cache.values()) {
    await cacheInvites(guild);

    const d = getGuildData(guild.id);

    for (const giveaway of Object.values(d.giveaways)) {
      if (giveaway.ended) continue;

      const remaining = giveaway.endAt - Date.now();

      if (remaining <= 0) {
        await endGiveaway(guild, giveaway.id);
      } else {
        setTimeout(async () => {
          const current = getGuildData(guild.id).giveaways[giveaway.id];

          if (current && !current.ended) {
            await endGiveaway(guild, giveaway.id);
          }
        }, remaining);
      }
    }
  }
});

// ======================================================
// INVITE CREATE / DELETE
// ======================================================

client.on("inviteCreate", async invite => {
  if (invite.guild) {
    await cacheInvites(invite.guild);
  }
});

client.on("inviteDelete", async invite => {
  if (invite.guild) {
    await cacheInvites(invite.guild);
  }
});

// ======================================================
// NUEVO MIEMBRO
// ======================================================

client.on("guildMemberAdd", async member => {
  const d = getGuildData(member.guild.id);

  if (d.welcomeChannel) {
    const c = member.guild.channels.cache.get(d.welcomeChannel);

    if (c?.isTextBased()) {
      await c.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle("♟️🃏 ¡NUEVO JUGADOR EN LA MESA! 🃏♟️")
            .setDescription(
              `¡Bienvenido ${member} 👋

Has entrado a ―═★❯❯ RƐɗ KɪƝƓS ♦ .! .

♟️ Mueve tus piezas con estrategia.
🃏 Juega tus cartas con inteligencia.

¡Esperamos que disfrutes de la comunidad! 🎉🎊

♣️ Pásate por <#1533949497812586646> <#1516922343195148520> <#1523782602379624662> para saber más de ti!!!!

♟️ Tu próximo movimiento puede cambiar la partida 🃏`
            )
            .setThumbnail(member.user.displayAvatarURL())
            .setFooter({
              text: "♟️ Tu próximo movimiento puede cambiar la partida 🃏"
            })
            .setTimestamp()
        ],
        allowedMentions: {
          users: [member.id]
        }
      }).catch(() => {});
    }
  }

  if (d.autoRole) {
    const role = member.guild.roles.cache.get(d.autoRole);

    if (role?.editable) {
      await member.roles.add(role).catch(() => {});
    }
  }

  const usedInvite = await detectInvite(member.guild);

  if (usedInvite?.inviter) {
    const inviterId = usedInvite.inviter.id;

    const stats = inviteStats(d, inviterId);

    stats.joins++;

    if (!stats.members.includes(member.id)) {
      stats.members.push(member.id);
    }

    d.memberInviters[member.id] = inviterId;

    saveData();

    if (d.inviteChannel) {
      const channel = member.guild.channels.cache.get(d.inviteChannel);

      if (channel?.isTextBased()) {
        const currentMembers = stats.members.filter(id =>
          member.guild.members.cache.has(id)
        ).length;

        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xf1c40f)
              .setTitle("🃏🔗 NUEVA INVITACIÓN ♟️")
              .setDescription(
                `👋 ${member} se ha unido a **${member.guild.name}**

♟️ **Invitado por:** <@${inviterId}>
🆕 **Nuevas:** ${stats.joins}
🚪 **Salieron:** ${stats.leaves}
👥 **En el servidor:** ${currentMembers}

🏰 **Miembros del servidor:** ${member.guild.memberCount}

♟️ Una nueva pieza entra en la partida. 🃏`
              )
              .setThumbnail(member.user.displayAvatarURL())
              .setTimestamp()
          ]
        }).catch(() => {});
      }
    }
  }
});

// ======================================================
// MIEMBRO SALE
// ======================================================

client.on("guildMemberRemove", async member => {
  const d = getGuildData(member.guild.id);

  const inviterId = d.memberInviters[member.id];

  if (!inviterId) return;

  const stats = inviteStats(d, inviterId);

  stats.leaves++;

  saveData();

  if (d.inviteChannel) {
    const channel = member.guild.channels.cache.get(d.inviteChannel);

    if (channel?.isTextBased()) {
      const currentMembers = stats.members.filter(id =>
        member.guild.members.cache.has(id)
      ).length;

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("🚪🃏 INVITADO SALIÓ")
            .setDescription(
              `**${member.user.tag}** salió del servidor.

♟️ **Había sido invitado por:** <@${inviterId}>
🆕 **Nuevas:** ${stats.joins}
🚪 **Salieron:** ${stats.leaves}
👥 **Siguen dentro:** ${currentMembers}`
            )
            .setTimestamp()
        ]
      }).catch(() => {});
    }
  }
});

// ======================================================
// COMANDOS CON PREFIJO
// ======================================================

client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;

  const d = getGuildData(message.guild.id);

  // NUEVO: CONTAR MENSAJES
  d.messageCounts[message.author.id] =
    (d.messageCounts[message.author.id] || 0) + 1;

  saveData();

  const lower = message.content.toLowerCase();

  if (d.autoReplies?.[lower]) {
    await message.channel.send({
      content: d.autoReplies[lower],
      allowedMentions: {
        parse: []
      }
    }).catch(() => {});
  }

  if (d.autoReactions?.[lower]) {
    await message.react(d.autoReactions[lower]).catch(() => {});
  }

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content
    .slice(PREFIX.length)
    .trim()
    .split(/\s+/);

  const cmd = args.shift()?.toLowerCase();

  if (!cmd) return;

  if (!(await adminOnlyMessage(message))) return;

  const reply = content => message.reply(content);

  if (cmd === "help" || cmd === "ayuda") {
    return reply({
      embeds: [helpEmbed()],
      components: [helpMenu()]
    });
  }

  if (cmd === "bienvenida") {
    if (args[0]?.toLowerCase() === "off") {
      d.welcomeChannel = null;
      saveData();

      return reply("♟️🃏 Bienvenidas desactivadas.");
    }

    const c = mentionedChannel(message);

    if (!c) {
      return reply(
        `❌ Usa **${PREFIX}bienvenida #canal** o **${PREFIX}bienvenida off**`
      );
    }

    d.welcomeChannel = c.id;
    saveData();

    return reply(`♟️🃏 Las bienvenidas aparecerán en ${c}.`);
  }

  if (cmd === "invite") {
    if (args[0]?.toLowerCase() === "off") {
      d.inviteChannel = null;
      saveData();

      return reply("🔗 Mensajes de invitaciones desactivados.");
    }

    const c = mentionedChannel(message);

    if (!c) {
      return reply("❌ Usa **b!invite #canal** o **b!invite off**");
    }

    d.inviteChannel = c.id;
    saveData();

    return reply(
      `🔗 Los mensajes de nuevas invitaciones aparecerán en ${c}.`
    );
  }

  if (cmd === "invites") {
    const member = mentionedMember(message) || message.member;

    const stats = inviteStats(d, member.id);

    const inside = stats.members.filter(id =>
      message.guild.members.cache.has(id)
    );

    const list = inside.length
      ? inside
          .slice(0, 30)
          .map((id, i) => `${i + 1}. <@${id}>`)
          .join("\n")
      : "Ninguno registrado.";

    return reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle(`🔗🃏 Invitaciones de ${member.user.username}`)
          .setThumbnail(member.user.displayAvatarURL())
          .addFields(
            {
              name: "🆕 Nuevas",
              value: `${stats.joins}`,
              inline: true
            },
            {
              name: "🚪 Salieron",
              value: `${stats.leaves}`,
              inline: true
            },
            {
              name: "👥 En el servidor",
              value: `${inside.length}`,
              inline: true
            },
            {
              name: "♟️ Usuarios invitados",
              value: list
            }
          )
          .setFooter({
            text: "Los datos se registran desde que Fusake comenzó a rastrear invites."
          })
          .setTimestamp()
      ]
    });
  }

  if (cmd === "autoroles" || cmd === "setautorole") {
    if (args[0]?.toLowerCase() === "off") {
      d.autoRole = null;
    } else {
      const r = mentionedRole(message);

      if (!r) {
        return reply("❌ Usa **b!autoroles @rol**");
      }

      d.autoRole = r.id;
    }

    saveData();

    return reply("🎭 Auto rol actualizado.");
  }

  if (cmd === "clearautorole") {
    d.autoRole = null;
    saveData();

    return reply("🃏 Auto rol eliminado correctamente.");
  }

  if (cmd === "logs" || cmd === "setlog") {
    if (args[0]?.toLowerCase() === "off") {
      d.logsChannel = null;
    } else {
      const c = mentionedChannel(message);

      if (!c) {
        return reply("❌ Usa **b!logs #canal**");
      }

      d.logsChannel = c.id;
    }

    saveData();

    return reply("📋 Canal de logs actualizado.");
  }

  if (cmd === "clearlogs") {
    d.logsChannel = null;
    saveData();

    return reply("♟️ Canal de logs eliminado.");
  }

  if (
    cmd === "maintenance" ||
    cmd === "maintenanceon" ||
    cmd === "maintenanceoff"
  ) {
    if (cmd === "maintenance") {
      d.maintenance = !d.maintenance;
    }

    if (cmd === "maintenanceon") {
      d.maintenance = true;
    }

    if (cmd === "maintenanceoff") {
      d.maintenance = false;
    }

    saveData();

    return reply(
      `🔧 Modo mantenimiento **${
        d.maintenance ? "ACTIVADO" : "DESACTIVADO"
      }**.`
    );
  }

  if (cmd === "config") {
    return reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle("♟️🃏 Configuración de Fusake")
          .addFields(
            {
              name: "👋 Bienvenida",
              value: d.welcomeChannel
                ? `<#${d.welcomeChannel}>`
                : "Desactivado",
              inline: true
            },
            {
              name: "🎭 Auto rol",
              value: d.autoRole
                ? `<@&${d.autoRole}>`
                : "Desactivado",
              inline: true
            },
            {
              name: "📋 Logs",
              value: d.logsChannel
                ? `<#${d.logsChannel}>`
                : "Desactivados",
              inline: true
            },
            {
              name: "🔗 Invitaciones",
              value: d.inviteChannel
                ? `<#${d.inviteChannel}>`
                : "Desactivadas",
              inline: true
            },
            {
              name: "🔧 Mantenimiento",
              value: d.maintenance
                ? "Activado"
                : "Desactivado",
              inline: true
            }
          )
      ]
    });
  }

  if (cmd === "resetconfig") {
    data[message.guild.id] = defaults();
    saveData();

    return reply("♻️ Configuración reiniciada.");
  }

  if (cmd === "autorespuestas" || cmd === "autoreacciones") {
    const key =
      cmd === "autorespuestas"
        ? "autoReplies"
        : "autoReactions";

    const trigger = args.shift()?.toLowerCase();

    const value = args.join(" ");

    if (!trigger || !value) {
      return reply(
        `❌ Usa **b!${cmd} palabra ${
          cmd === "autorespuestas"
            ? "respuesta"
            : "emoji"
        }**`
      );
    }

    d[key][trigger] = value;
    saveData();

    return reply("🤖 Configuración guardada.");
  }

  if (cmd === "delreply" || cmd === "delreaction") {
    const key =
      cmd === "delreply"
        ? "autoReplies"
        : "autoReactions";

    const trigger = args[0]?.toLowerCase();

    if (!trigger) {
      return reply("❌ Debes indicar la palabra.");
    }

    delete d[key][trigger];

    saveData();

    return reply("🗑️ Configuración eliminada.");
  }

  if (cmd === "ban" || cmd === "kick") {
    const member = mentionedMember(message);

    if (!member) {
      return reply(`❌ Usa **b!${cmd} @usuario [razón]**`);
    }

    const reason =
      args.slice(1).join(" ") ||
      "Sin razón especificada";

    try {
      if (cmd === "ban") {
        if (!member.bannable) {
          return reply(
            "❌ No puedo banear a ese usuario. Revisa la jerarquía de roles."
          );
        }

        await member.ban({ reason });
      } else {
        if (!member.kickable) {
          return reply(
            "❌ No puedo expulsar a ese usuario. Revisa la jerarquía de roles."
          );
        }

        await member.kick(reason);
      }

      await sendLog(
        message.guild,
        cmd === "ban"
          ? "USUARIO BANEADO"
          : "USUARIO EXPULSADO",
        `**Usuario:** ${member.user.tag}
**Moderador:** ${message.author.tag}
**Razón:** ${reason}`,
        0xe74c3c
      );

      return reply(
        `${cmd === "ban" ? "🔨" : "🚪"} **${member.user.tag}**
📝 Razón: **${reason}**`
      );
    } catch (error) {
      return reply(
        `❌ No pude realizar la acción: ${error.message}`
      );
    }
  }

  if (cmd === "unban") {
    const id = args[0];

    if (!id) {
      return reply("❌ Usa **b!unban ID**");
    }

    try {
      const user = await message.guild.members.unban(
        id,
        `Desbaneado por ${message.author.tag}`
      );

      await sendLog(
        message.guild,
        "USUARIO DESBANEADO",
        `**Usuario:** ${user.tag}
**Por:** ${message.author.tag}`,
        0x2ecc71
      );

      return reply(`🔓♟️ **${user.tag}** fue desbaneado.`);
    } catch {
      return reply(
        "❌ No pude desbanear ese ID. Comprueba que esté baneado."
      );
    }
  }

  if (cmd === "softban") {
    const member = mentionedMember(message);

    if (!member) {
      return reply("❌ Usa **b!softban @usuario [razón]**");
    }

    if (!member.bannable) {
      return reply("❌ No puedo aplicar softban a ese usuario.");
    }

    const reason =
      args.slice(1).join(" ") ||
      "Sin razón especificada";

    try {
      await member.ban({
        reason,
        deleteMessageSeconds: 86400
      });

      await message.guild.members.unban(member.id);

      await sendLog(
        message.guild,
        "SOFTBAN",
        `**Usuario:** ${member.user.tag}
**Por:** ${message.author.tag}
**Razón:** ${reason}`
      );

      return reply(
        `♟️🃏 Softban aplicado a **${member.user.tag}**.`
      );
    } catch {
      return reply("❌ No pude aplicar el softban.");
    }
  }

  if (cmd === "timeout" || cmd === "untimeout") {
    const member = mentionedMember(message);

    if (!member) {
      return reply("❌ Debes mencionar un usuario.");
    }

    if (!member.moderatable) {
      return reply("❌ No puedo moderar a ese usuario.");
    }

    try {
      if (cmd === "untimeout") {
        await member.timeout(
          null,
          `Retirado por ${message.author.tag}`
        );

        return reply(
          `🃏 Timeout retirado a **${member.user.tag}**.`
        );
      }

      const minutes = Number(args[1]);

      if (
        !Number.isFinite(minutes) ||
        minutes < 1 ||
        minutes > 40320
      ) {
        return reply(
          "❌ Indica entre **1 y 40320 minutos**."
        );
      }

      await member.timeout(
        minutes * 60000,
        `Aplicado por ${message.author.tag}`
      );

      await sendLog(
        message.guild,
        "TIMEOUT",
        `**Usuario:** ${member.user.tag}
**Duración:** ${minutes} minutos
**Por:** ${message.author.tag}`
      );

      return reply(
        `⏳ **${member.user.tag}** recibió timeout de **${minutes} minutos**.`
      );
    } catch {
      return reply("❌ No pude modificar el timeout.");
    }
  }

  if (
    cmd === "warn" ||
    cmd === "warnings" ||
    cmd === "clearwarnings"
  ) {
    const member = mentionedMember(message);

    if (!member) {
      return reply("❌ Debes mencionar un usuario.");
    }

    if (cmd === "warn") {
      d.warnings[member.id] ??= [];

      const reason =
        args.slice(1).join(" ") ||
        "Sin razón especificada";

      d.warnings[member.id].push({
        reason,
        moderator: message.author.tag,
        date: new Date().toISOString()
      });

      saveData();

      await sendLog(
        message.guild,
        "ADVERTENCIA",
        `**Usuario:** ${member.user.tag}
**Moderador:** ${message.author.tag}
**Razón:** ${reason}`
      );

      return reply(
        `⚠️ **${member.user.tag}** recibió una advertencia.`
      );
    }

    if (cmd === "clearwarnings") {
      delete d.warnings[member.id];

      saveData();

      return reply(
        `🧹 Advertencias eliminadas de **${member.user.tag}**.`
      );
    }

    const warnings = d.warnings[member.id];

    return reply(
      warnings?.length
        ? warnings
            .map(
              (warning, index) =>
                `**${index + 1}.** ${warning.reason} — ${warning.moderator}`
            )
            .join("\n")
        : `✅ **${member.user.tag}** no tiene advertencias.`
    );
  }

  if (
    cmd === "purge" ||
    cmd === "clear" ||
    cmd === "clearchannel"
  ) {
    const n =
      Number(args[0]) ||
      (cmd === "clearchannel" ? 50 : 0);

    if (n < 1 || n > 100) {
      return reply(
        "❌ Usa una cantidad entre **1 y 100**."
      );
    }

    try {
      const deleted =
        await message.channel.bulkDelete(n, true);

      return message.channel.send(
        `♟️🧹 Se limpiaron **${deleted.size} mensajes**.`
      );
    } catch {
      return reply("❌ No pude limpiar el canal.");
    }
  }

  if (cmd === "lock" || cmd === "unlock") {
    try {
      await message.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        {
          SendMessages:
            cmd === "lock"
              ? false
              : null
        }
      );

      return reply(
        cmd === "lock"
          ? "🔒♟️ Canal bloqueado."
          : "🔓🃏 Canal desbloqueado."
      );
    } catch {
      return reply("❌ No pude cambiar los permisos del canal.");
    }
  }

  if (cmd === "lockall" || cmd === "unlockall") {
    let changed = 0;

    for (const c of message.guild.channels.cache.values()) {
      if (
        c.type !== ChannelType.GuildText &&
        c.type !== ChannelType.GuildAnnouncement
      ) {
        continue;
      }

      try {
        await c.permissionOverwrites.edit(
          message.guild.roles.everyone,
          {
            SendMessages:
              cmd === "lockall"
                ? false
                : null
          }
        );

        changed++;
      } catch {}
    }

    return reply(
      `${
        cmd === "lockall"
          ? "🔒♟️"
          : "🔓🃏"
      } Se actualizaron **${changed} canales**.`
    );
  }

  if (cmd === "slowmode") {
    const n = Number(args[0]);

    if (
      Number.isNaN(n) ||
      n < 0 ||
      n > 21600
    ) {
      return reply(
        "❌ Usa un valor entre **0 y 21600 segundos**."
      );
    }

    try {
      await message.channel.setRateLimitPerUser(n);

      return reply(
        `🐌 Slowmode establecido en **${n} segundos**.`
      );
    } catch {
      return reply("❌ No pude modificar el slowmode.");
    }
  }

  if (cmd === "nick") {
    const member = mentionedMember(message);

    const name = args.slice(1).join(" ");

    if (!member || !name) {
      return reply(
        "❌ Usa **b!nick @usuario nuevo nombre**"
      );
    }

    if (!member.manageable) {
      return reply(
        "❌ No puedo cambiar el apodo de ese usuario."
      );
    }

    try {
      await member.setNickname(name);

      return reply(`✏️ Apodo actualizado a **${name}**.`);
    } catch {
      return reply("❌ No pude cambiar el apodo.");
    }
  }

  if (cmd === "dehoist") {
    let changed = 0;

    const members =
      message.guild.members.cache.filter(member =>
        /^[^a-zA-Z0-9áéíóúÁÉÍÓÚ]/.test(
          member.displayName
        )
      );

    for (const member of members.values()) {
      if (!member.manageable) continue;

      const newName = member.displayName.replace(
        /^[^a-zA-Z0-9áéíóúÁÉÍÓÚ]+/,
        ""
      );

      if (!newName) continue;

      try {
        await member.setNickname(newName);
        changed++;
      } catch {}
    }

    return reply(
      `✏️ Se corrigieron **${changed} nombres**.`
    );
  }

  if (
    cmd === "roleall" ||
    cmd === "removeroleall"
  ) {
    const r = mentionedRole(message);

    if (
      !r ||
      r.position >=
        message.guild.members.me.roles.highest.position
    ) {
      return reply(
        "❌ Rol inválido o superior al rol de Fusake."
      );
    }

    let changed = 0;

    for (const member of message.guild.members.cache.values()) {
      try {
        if (
          cmd === "roleall" &&
          !member.user.bot &&
          !member.roles.cache.has(r.id)
        ) {
          await member.roles.add(r);
          changed++;
        }

        if (
          cmd === "removeroleall" &&
          member.roles.cache.has(r.id)
        ) {
          await member.roles.remove(r);
          changed++;
        }
      } catch {}
    }

    return reply(
      `♟️🃏 Se modificó el rol en **${changed} usuarios**.`
    );
  }

  if (
    cmd === "checkmember" ||
    cmd === "userinfo"
  ) {
    const member =
      mentionedMember(message) ||
      message.member;

    return reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(`♟️🃏 ${member.user.tag}`)
          .setThumbnail(member.user.displayAvatarURL())
          .addFields(
            {
              name: "🆔 ID",
              value: member.id,
              inline: true
            },
            {
              name: "🟢 Estado",
              value:
                member.presence?.status ||
                "offline",
              inline: true
            },
            {
              name: "📅 Cuenta creada",
              value: `<t:${Math.floor(
                member.user.createdTimestamp / 1000
              )}:F>`
            },
            {
              name: "🏠 Entró al servidor",
              value: member.joinedTimestamp
                ? `<t:${Math.floor(
                    member.joinedTimestamp / 1000
                  )}:F>`
                : "Desconocido"
            },
            {
              name: "🎭 Roles",
              value:
                member.roles.cache
                  .filter(
                    role =>
                      role.id !== message.guild.id
                  )
                  .map(String)
                  .join(", ")
                  .slice(0, 1000) ||
                "Ninguno"
            }
          )
      ]
    });
  }

  if (cmd === "serverinfo") {
    return reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(`♟️🃏 ${message.guild.name}`)
          .setThumbnail(message.guild.iconURL())
          .setDescription(
            `👑 Dueño: <@${message.guild.ownerId}>
👥 Miembros: ${message.guild.memberCount}
💬 Canales: ${message.guild.channels.cache.size}
🎭 Roles: ${message.guild.roles.cache.size}
😀 Emojis: ${message.guild.emojis.cache.size}
🚀 Boosts: ${message.guild.premiumSubscriptionCount || 0}`
          )
      ]
    });
  }

  if (
    cmd === "members" ||
    cmd === "membercount"
  ) {
    return reply(
      `👥 Miembros: **${message.guild.memberCount}**`
    );
  }

  if (cmd === "bots" || cmd === "humans") {
    const count =
      message.guild.members.cache.filter(member =>
        cmd === "bots"
          ? member.user.bot
          : !member.user.bot
      ).size;

    return reply(
      `${
        cmd === "bots"
          ? "🤖 Bots"
          : "♟️ Jugadores humanos"
      }: **${count}**`
    );
  }

  if (cmd === "emojis") {
    return reply(
      `😀 Emojis: **${message.guild.emojis.cache.size}**`
    );
  }

  if (cmd === "boosts") {
    return reply(
      `🚀 Boosts: **${message.guild.premiumSubscriptionCount || 0}**`
    );
  }

  if (cmd === "rolecount") {
    return reply(
      `🎭 Roles: **${message.guild.roles.cache.size - 1}**`
    );
  }

  if (cmd === "categorycount") {
    return reply(
      `📂 Categorías: **${
        message.guild.channels.cache.filter(
          c => c.type === ChannelType.GuildCategory
        ).size
      }**`
    );
  }

  if (cmd === "channelcount") {
    return reply(
      `♟️ Texto: **${
        message.guild.channels.cache.filter(
          c => c.type === ChannelType.GuildText
        ).size
      }**
🃏 Voz: **${
        message.guild.channels.cache.filter(
          c => c.type === ChannelType.GuildVoice
        ).size
      }**`
    );
  }

  if (cmd === "memberlist") {
    const members =
      message.guild.members.cache
        .filter(member => !member.user.bot)
        .first(30)
        .map(member => `♟️ ${member}`)
        .join("\n");

    return reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle("♟️🃏 Jugadores de la mesa")
          .setDescription(
            members ||
              "No hay miembros disponibles."
          )
      ]
    });
  }

  if (cmd === "roles") {
    const roles =
      message.guild.roles.cache
        .filter(
          role =>
            role.id !== message.guild.id
        )
        .map(role => role.toString())
        .slice(0, 50)
        .join("\n");

    return reply(roles || "No hay roles.");
  }

  if (cmd === "roleinfo") {
    const r = mentionedRole(message);

    if (!r) {
      return reply("❌ Usa **b!roleinfo @rol**");
    }

    return reply(
      `🃏 **${r.name}**
🆔 ${r.id}
👥 ${r.members.size} miembros
📌 Posición ${r.position}`
    );
  }

  if (cmd === "channelinfo") {
    const c =
      mentionedChannel(message) ||
      message.channel;

    return reply(
      `💬 **${c.name}**
🆔 ${c.id}
📂 Tipo: ${c.type}`
    );
  }

  if (
    cmd === "servericon" ||
    cmd === "serverbanner"
  ) {
    const url =
      cmd === "servericon"
        ? message.guild.iconURL({
            size: 1024
          })
        : message.guild.bannerURL({
            size: 1024
          });

    if (!url) {
      return reply("❌ No disponible.");
    }

    return reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle(
            cmd === "servericon"
              ? "♟️ Icono del servidor"
              : "🃏 Banner del servidor"
          )
          .setImage(url)
      ]
    });
  }

  if (cmd === "staff") {
    const staff =
      message.guild.members.cache
        .filter(member =>
          member.permissions.has(
            PermissionFlagsBits.Administrator
          )
        )
        .first(30)
        .map(member => `👑 ${member}`)
        .join("\n");

    return reply(
      staff ||
        "No se encontraron administradores."
    );
  }

  if (cmd === "permissions") {
    const member =
      mentionedMember(message) ||
      message.member;

    const perms = member.permissions
      .toArray()
      .map(p => `• ${p}`)
      .join("\n")
      .slice(0, 1900);

    return reply(perms || "Sin permisos.");
  }

  if (cmd === "avatar") {
    const member =
      mentionedMember(message) ||
      message.member;

    return reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle(`🃏 Avatar de ${member.user.tag}`)
          .setImage(
            member.user.displayAvatarURL({
              size: 1024
            })
          )
      ]
    });
  }

  if (cmd === "created") {
    return reply(
      `📅 El servidor fue creado <t:${Math.floor(
        message.guild.createdTimestamp / 1000
      )}:F>.`
    );
  }

  if (cmd === "say") {
    const text = args.join(" ");

    if (!text) {
      return reply("❌ Usa **b!say mensaje**");
    }

    await message.delete().catch(() => {});

    return message.channel.send({
      content: text,
      allowedMentions: {
        parse: []
      }
    });
  }

  if (cmd === "announce") {
    const text = args.join(" ");

    if (!text) {
      return reply("❌ Usa **b!announce mensaje**");
    }

    return message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle("♟️🃏 ANUNCIO")
          .setDescription(text)
          .setTimestamp()
      ]
    });
  }

  if (cmd === "embed") {
    const colorInput = args.shift();

    const color = parseColor(colorInput);

    const text = args.join(" ");

    if (color === null || !text) {
      return reply(
        "❌ Usa **b!embed #ff0000 mensaje**"
      );
    }

    return message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(color)
          .setDescription(text)
      ]
    });
  }

  if (cmd === "poll") {
    const question = args.join(" ");

    if (!question) {
      return reply("❌ Usa **b!poll pregunta**");
    }

    const poll =
      await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle("♟️🃏 Encuesta")
            .setDescription(question)
            .setFooter({
              text: "👍 Sí • 👎 No"
            })
        ]
      });

    await poll.react("👍").catch(() => {});
    await poll.react("👎").catch(() => {});

    return;
  }

  if (
    cmd === "move" ||
    cmd === "disconnect"
  ) {
    const member =
      mentionedMember(message);

    if (!member) {
      return reply("❌ Debes mencionar un usuario.");
    }

    try {
      if (cmd === "move") {
        const c = mentionedChannel(message);

        if (
          !c ||
          c.type !== ChannelType.GuildVoice
        ) {
          return reply("❌ Menciona un canal de voz.");
        }

        await member.voice.setChannel(c);

        return reply(
          `🔊 **${member.user.tag}** fue movido a ${c}.`
        );
      }

      await member.voice.disconnect();

      return reply(
        `🔇 **${member.user.tag}** fue desconectado.`
      );
    } catch {
      return reply(
        "❌ No pude modificar el canal de voz del usuario."
      );
    }
  }

  if (
    cmd === "addrole" ||
    cmd === "removerole" ||
    cmd === "role"
  ) {
    let action;

    if (cmd === "role") {
      action = args[0]?.toLowerCase();
    } else {
      action =
        cmd === "addrole"
          ? "add"
          : "remove";
    }

    const member = mentionedMember(message);
    const r = mentionedRole(message);

    if (
      !member ||
      !r ||
      !["add", "remove"].includes(action)
    ) {
      return reply(
        "❌ Usa **b!role add @usuario @rol** o **b!role remove @usuario @rol**"
      );
    }

    if (
      r.position >=
      message.guild.members.me.roles.highest.position
    ) {
      return reply(
        "❌ Ese rol está por encima de Fusake."
      );
    }

    try {
      if (action === "add") {
        await member.roles.add(r);
      } else {
        await member.roles.remove(r);
      }

      return reply(
        `🎭 Rol ${r} ${
          action === "add"
            ? "añadido a"
            : "eliminado de"
        } **${member.user.tag}**.`
      );
    } catch {
      return reply("❌ No pude modificar ese rol.");
    }
  }

  if (cmd === "setstatus") {
    const text = args.join(" ");

    if (!text) {
      return reply("❌ Usa **b!setstatus texto**");
    }

    client.user.setPresence({
      activities: [
        {
          name: text,
          type: 0
        }
      ],
      status: "online"
    });

    return reply(
      `🤖 Estado cambiado a **${text}**.`
    );
  }

  if (cmd === "renamechannel") {
    const name = args
      .join("-")
      .toLowerCase();

    if (!name) {
      return reply(
        "❌ Usa **b!renamechannel nuevo-nombre**"
      );
    }

    try {
      await message.channel.setName(name);

      return reply(
        `🃏 Canal renombrado a **${name}**.`
      );
    } catch {
      return reply("❌ No pude renombrar el canal.");
    }
  }

  if (cmd === "dm") {
    const member = mentionedMember(message);

    const text = args.slice(1).join(" ");

    if (!member || !text) {
      return reply(
        "❌ Usa **b!dm @usuario mensaje**"
      );
    }

    try {
      await member.send({
        content: text,
        allowedMentions: {
          parse: []
        }
      });

      return reply("💌 Mensaje enviado.");
    } catch {
      return reply("❌ No pude enviar el MD.");
    }
  }

  if (cmd === "react") {
    if (!args[0]) {
      return reply("❌ Usa **b!react emoji**");
    }

    try {
      await message.react(args[0]);

      return;
    } catch {
      return reply("❌ No pude añadir esa reacción.");
    }
  }

  if (cmd === "clearlast") {
    const messages =
      await message.channel.messages
        .fetch({
          limit: 10
        })
        .catch(() => null);

    if (!messages) {
      return reply("❌ No pude obtener los mensajes.");
    }

    const botMessages =
      messages.filter(
        m => m.author.id === client.user.id
      );

    let deleted = 0;

    for (const msg of botMessages.values()) {
      try {
        await msg.delete();
        deleted++;
      } catch {}
    }

    return message.channel.send(
      `♟️ Eliminé **${deleted} mensajes recientes de Fusake**.`
    );
  }

  // ====================================================
  // SORTEO + REQUISITOS
  // ====================================================

  if (cmd === "sorteo") {
    const fullText = args.join(" ");

    const sections = fullText.split("|");

    const main = sections[0]
      .trim()
      .split(/\s+/);

    const requirementsText =
      sections.slice(1).join("|").trim();

    const timeText = main.shift();
    const winners = Number(main.shift());
    const prize = main.join(" ");

    const time = parseDuration(timeText);

    if (
      !time ||
      !Number.isInteger(winners) ||
      winners < 1 ||
      winners > 50 ||
      !prize
    ) {
      return reply(
        "❌ Usa **b!sorteo 1h30m 2 Premio**\nCon requisitos: **b!sorteo 1h30m 2 Premio | 5 invites, 1000 mensajes**"
      );
    }

    try {
      const giveaway =
        await createGiveaway(
          message.guild,
          message.channel,
          message.author.id,
          time,
          winners,
          prize,
          requirementsText
        );

      return reply(
        `🎉 Sorteo creado correctamente.\n🆔 ID: \`${giveaway.id}\``
      );
    } catch {
      return reply("❌ No pude crear el sorteo.");
    }
  }

  if (cmd === "sorteoend") {
    const id = args[0];

    if (!id) {
      return reply("❌ Usa **b!sorteoend ID**");
    }

    const result =
      await endGiveaway(
        message.guild,
        id
      );

    return reply(
      result.ok
        ? "🎉 Sorteo finalizado."
        : result.message
    );
  }

  if (cmd === "sorteoreroll") {
    const id = args[0];

    if (!id) {
      return reply("❌ Usa **b!sorteoreroll ID**");
    }

    const result =
      await endGiveaway(
        message.guild,
        id,
        true
      );

    return reply(
      result.ok
        ? "🔄 Nuevos ganadores seleccionados."
        : result.message
    );
  }

  if (cmd === "botavatar") {
    if (!args[0]) {
      return reply("❌ Usa **b!botavatar URL**");
    }

    try {
      await client.user.setAvatar(args[0]);

      return reply(
        "♟️🃏 Avatar de Fusake actualizado."
      );
    } catch {
      return reply("❌ No pude cambiar el avatar.");
    }
  }

  if (cmd === "botname") {
    const name = args.join(" ");

    if (!name) {
      return reply("❌ Usa **b!botname nombre**");
    }

    try {
      await client.user.setUsername(name);

      return reply("🃏 Nombre del bot cambiado.");
    } catch {
      return reply("❌ No pude cambiar el nombre.");
    }
  }

  if (cmd === "restart") {
    await reply("♟️ Fusake se está reiniciando...");

    setTimeout(
      () => process.exit(0),
      1500
    );

    return;
  }

  if (cmd === "serverlist") {
    const list =
      client.guilds.cache
        .map(
          guild =>
            `♟️ **${guild.name}** — ${guild.memberCount} miembros`
        )
        .join("\n")
        .slice(0, 1900);

    return reply(list || "Sin servidores.");
  }

  if (cmd === "memory") {
    const memory = process.memoryUsage();

    return reply(
      `🧠 RAM utilizada: **${Math.round(
        memory.heapUsed /
          1024 /
          1024
      )} MB**
📦 Heap total: **${Math.round(
        memory.heapTotal /
          1024 /
          1024
      )} MB**`
    );
  }

  if (cmd === "botinfo") {
    return reply(
      `♟️🃏 **${client.user.tag}**

🌐 Servidores: ${client.guilds.cache.size}
📡 Ping: ${client.ws.ping}ms
⚡ Prefijo: ${PREFIX}
🤖 Slash commands: /`
    );
  }

  if (cmd === "uptime") {
    return reply(
      `⏱️ Fusake lleva encendido **${duration(
        client.uptime
      )}**.`
    );
  }

  if (cmd === "ping") {
    return reply(
      `🏓 Pong! **${client.ws.ping}ms**`
    );
  }

  return reply(
    `❓ Comando desconocido. Usa **${PREFIX}help** para ver el menú.`
  );
});

// ======================================================
// INTERACCIONES
// ======================================================

client.on("interactionCreate", async interaction => {
  if (!interaction.guild) return;

  // ====================================================
  // HELP MENU
  // ====================================================

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "fusake_help"
  ) {
    if (!(await adminOnlyInteraction(interaction))) {
      return;
    }

    const selected = help[interaction.values[0]];

    if (!selected) {
      return interaction.reply({
        content: "❌ Categoría no encontrada.",
        ephemeral: true
      });
    }

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle(selected[0])
          .setDescription(
            selected
              .slice(1)
              .map(command =>
                command
                  ? `**${command}**`
                  : "\u200b"
              )
              .join("\n")
          )
          .setFooter({
            text: "♟️🃏 Fusake • Solo administradores"
          })
          .setTimestamp()
      ],
      ephemeral: true
    });
  }

  // ====================================================
  // NUEVO: MENÚ DE ROLES
  // ====================================================

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("reacrol_menu:")
  ) {
    const messageId =
      interaction.customId.split(":")[1];

    const d = getGuildData(interaction.guild.id);

    const panel =
      getReactionRolePanel(d, messageId);

    if (!panel || panel.type !== "MENU") {
      return interaction.reply({
        content:
          "❌ Este menú de roles ya no está configurado.",
        ephemeral: true
      });
    }

    const selectedRoleId =
      interaction.values[0];

    const selectedOption =
      panel.options.find(
        option =>
          option.roleId === selectedRoleId
      );

    if (!selectedOption) {
      return interaction.reply({
        content: "❌ Rol no encontrado.",
        ephemeral: true
      });
    }

    const member =
      await interaction.guild.members
        .fetch(interaction.user.id)
        .catch(() => null);

    if (!member) {
      return interaction.reply({
        content: "❌ No pude encontrar tu usuario.",
        ephemeral: true
      });
    }

    const role =
      interaction.guild.roles.cache.get(
        selectedRoleId
      );

    if (!role) {
      return interaction.reply({
        content:
          "❌ Ese rol ya no existe.",
        ephemeral: true
      });
    }

    if (!role.editable) {
      return interaction.reply({
        content:
          "❌ Fusake no puede administrar ese rol. Coloca el rol de Fusake por encima.",
        ephemeral: true
      });
    }

    try {
      // QUITAR TODOS LOS DEMÁS ROLES DE ESTE MISMO MENÚ
      for (const option of panel.options) {
        if (
          option.roleId !== selectedRoleId &&
          member.roles.cache.has(option.roleId)
        ) {
          const oldRole =
            interaction.guild.roles.cache.get(
              option.roleId
            );

          if (oldRole?.editable) {
            await member.roles.remove(oldRole);
          }
        }
      }

      // AGREGAR EL NUEVO
      if (!member.roles.cache.has(selectedRoleId)) {
        await member.roles.add(role);
      }

      return interaction.reply({
        content:
          `✅ Ahora tenés el rol ${role}.\n♟️ Si tenías otro rol de este menú, fue retirado automáticamente.`,
        ephemeral: true
      });
    } catch (error) {
      return interaction.reply({
        content:
          `❌ No pude modificar tus roles: ${error.message}`,
        ephemeral: true
      });
    }
  }

  // ====================================================
  // BOTONES
  // ====================================================

  if (interaction.isButton()) {

    // ==================================================
    // NUEVO: BOTONES DE ROLES
    // ==================================================

    if (
      interaction.customId.startsWith(
        "reacrol_button:"
      )
    ) {
      const parts =
        interaction.customId.split(":");

      const messageId = parts[1];
      const roleId = parts[2];

      const d =
        getGuildData(interaction.guild.id);

      const panel =
        getReactionRolePanel(d, messageId);

      if (!panel || panel.type !== "BOTON") {
        return interaction.reply({
          content:
            "❌ Este botón de rol ya no está configurado.",
          ephemeral: true
        });
      }

      const option =
        panel.options.find(
          item => item.roleId === roleId
        );

      if (!option) {
        return interaction.reply({
          content:
            "❌ Esta opción ya no existe.",
          ephemeral: true
        });
      }

      const member =
        await interaction.guild.members
          .fetch(interaction.user.id)
          .catch(() => null);

      if (!member) {
        return interaction.reply({
          content:
            "❌ No pude encontrar tu usuario.",
          ephemeral: true
        });
      }

      const role =
        interaction.guild.roles.cache.get(
          roleId
        );

      if (!role) {
        return interaction.reply({
          content:
            "❌ Ese rol ya no existe.",
          ephemeral: true
        });
      }

      if (!role.editable) {
        return interaction.reply({
          content:
            "❌ Fusake no puede administrar ese rol. Coloca el rol de Fusake por encima.",
          ephemeral: true
        });
      }

      try {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(role);

          return interaction.reply({
            content:
              `➖ Te quité el rol ${role}.`,
            ephemeral: true
          });
        }

        await member.roles.add(role);

        return interaction.reply({
          content:
            `➕ Te agregué el rol ${role}.`,
          ephemeral: true
        });
      } catch (error) {
        return interaction.reply({
          content:
            `❌ No pude modificar el rol: ${error.message}`,
          ephemeral: true
        });
      }
    }

    // ==================================================
    // SORTEO PARTICIPAR + REQUISITOS
    // ==================================================

    if (
      interaction.customId.startsWith(
        "giveaway_join:"
      )
    ) {
      const id =
        interaction.customId.split(":")[1];

      const d =
        getGuildData(interaction.guild.id);

      const giveaway =
        d.giveaways[id];

      if (!giveaway) {
        return interaction.reply({
          content:
            "❌ Este sorteo ya no existe.",
          ephemeral: true
        });
      }

      if (giveaway.ended) {
        return interaction.reply({
          content:
            "❌ Este sorteo ya terminó.",
          ephemeral: true
        });
      }

      // SI YA ESTÁ PARTICIPANDO, PUEDE SALIR SIN COMPROBAR REQUISITOS
      if (
        giveaway.participants.includes(
          interaction.user.id
        )
      ) {
        giveaway.participants =
          giveaway.participants.filter(
            id =>
              id !== interaction.user.id
          );

        saveData();

        try {
          await interaction.message.edit({
            embeds: [
              giveawayEmbed(giveaway)
            ],
            components: [
              giveawayButtons(
                giveaway.id
              )
            ]
          });
        } catch {}

        return interaction.reply({
          content:
            "🚪 Saliste del sorteo.",
          ephemeral: true
        });
      }

      // COMPROBAR REQUISITOS
      const requirementCheck =
        checkGiveawayRequirements(
          interaction.guild,
          interaction.user.id,
          giveaway
        );

      if (!requirementCheck.ok) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle(
                "❌ NO CUMPLES LOS REQUISITOS"
              )
              .setDescription(
                `No podés participar todavía en este sorteo.

${requirementCheck.failed.join("\n")}

📋 **Requisitos del sorteo**
${requirementText(giveaway)}`
              )
              .setFooter({
                text:
                  "♟️ Cumple los requisitos e inténtalo nuevamente 🃏"
              })
          ],
          ephemeral: true
        });
      }

      giveaway.participants.push(
        interaction.user.id
      );

      saveData();

      try {
        await interaction.message.edit({
          embeds: [
            giveawayEmbed(giveaway)
          ],
          components: [
            giveawayButtons(
              giveaway.id
            )
          ]
        });
      } catch {}

      return interaction.reply({
        content:
          `🎉 ¡Ya estás participando por **${giveaway.prize}**!`,
        ephemeral: true
      });
    }

    if (
      interaction.customId.startsWith(
        "giveaway_users:"
      )
    ) {
      const id =
        interaction.customId.split(":")[1];

      const d =
        getGuildData(interaction.guild.id);

      const giveaway =
        d.giveaways[id];

      if (!giveaway) {
        return interaction.reply({
          content:
            "❌ Sorteo no encontrado.",
          ephemeral: true
        });
      }

      const users =
        giveaway.participants.length
          ? giveaway.participants
              .slice(0, 50)
              .map(
                (userId, index) =>
                  `${index + 1}. <@${userId}>`
              )
              .join("\n")
          : "Todavía no hay participantes.";

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(
              "👥 Participantes del sorteo"
            )
            .setDescription(users)
            .setFooter({
              text:
                `Total: ${giveaway.participants.length}`
            })
        ],
        ephemeral: true
      });
    }
  }

  // ====================================================
  // SLASH COMMANDS
  // ====================================================

  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (
    !(await adminOnlyInteraction(interaction))
  ) {
    return;
  }

  const d =
    getGuildData(interaction.guild.id);

  const cmd =
    interaction.commandName;

  if (cmd === "help") {
    return interaction.reply({
      embeds: [helpEmbed()],
      components: [helpMenu()],
      ephemeral: true
    });
  }

  if (cmd === "ping") {
    return interaction.reply({
      content:
        `🏓 Pong! **${client.ws.ping}ms**`,
      ephemeral: true
    });
  }

  if (cmd === "uptime") {
    return interaction.reply({
      content:
        `⏱️ Fusake lleva encendido **${duration(
          client.uptime
        )}**.`,
      ephemeral: true
    });
  }

  if (cmd === "botinfo") {
    return interaction.reply({
      content:
        `♟️🃏 **${client.user.tag}**

🌐 Servidores: ${client.guilds.cache.size}
📡 Ping: ${client.ws.ping}ms
⚡ Prefijo: ${PREFIX}
🤖 Slash commands: /`,
      ephemeral: true
    });
  }

  if (cmd === "embed") {
    const colorText =
      interaction.options.getString(
        "color",
        true
      );

    const text =
      interaction.options.getString(
        "mensaje",
        true
      );

    const color =
      parseColor(colorText);

    if (color === null) {
      return interaction.reply({
        content:
          "❌ Color inválido. Ejemplo: `#ff0000`",
        ephemeral: true
      });
    }

    await interaction.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(color)
          .setDescription(text)
      ]
    });

    return interaction.reply({
      content:
        "✅ Embed enviado.",
      ephemeral: true
    });
  }

  if (cmd === "bienvenida") {
    const disable =
      interaction.options.getBoolean(
        "desactivar"
      );

    const channel =
      interaction.options.getChannel(
        "canal"
      );

    if (disable) {
      d.welcomeChannel = null;
      saveData();

      return interaction.reply({
        content:
          "♟️ Bienvenidas desactivadas.",
        ephemeral: true
      });
    }

    if (!channel) {
      return interaction.reply({
        content:
          "❌ Selecciona un canal o usa `desactivar`.",
        ephemeral: true
      });
    }

    d.welcomeChannel = channel.id;

    saveData();

    return interaction.reply({
      content:
        `👋 Bienvenidas configuradas en ${channel}.`,
      ephemeral: true
    });
  }

  if (cmd === "logs") {
    const disable =
      interaction.options.getBoolean(
        "desactivar"
      );

    const channel =
      interaction.options.getChannel(
        "canal"
      );

    if (disable) {
      d.logsChannel = null;
      saveData();

      return interaction.reply({
        content:
          "📋 Logs desactivados.",
        ephemeral: true
      });
    }

    if (!channel) {
      return interaction.reply({
        content:
          "❌ Selecciona un canal.",
        ephemeral: true
      });
    }

    d.logsChannel = channel.id;

    saveData();

    return interaction.reply({
      content:
        `📋 Logs configurados en ${channel}.`,
      ephemeral: true
    });
  }

  if (cmd === "autorole") {
    const disable =
      interaction.options.getBoolean(
        "desactivar"
      );

    const role =
      interaction.options.getRole(
        "rol"
      );

    if (disable) {
      d.autoRole = null;
      saveData();

      return interaction.reply({
        content:
          "🎭 Autorol desactivado.",
        ephemeral: true
      });
    }

    if (!role) {
      return interaction.reply({
        content:
          "❌ Selecciona un rol.",
        ephemeral: true
      });
    }

    if (
      role.position >=
      interaction.guild.members.me
        .roles.highest.position
    ) {
      return interaction.reply({
        content:
          "❌ Ese rol está por encima del rol de Fusake.",
        ephemeral: true
      });
    }

    d.autoRole = role.id;

    saveData();

    return interaction.reply({
      content:
        `🎭 Autorol configurado: ${role}.`,
      ephemeral: true
    });
  }

  if (cmd === "invite") {
    const disable =
      interaction.options.getBoolean(
        "desactivar"
      );

    const channel =
      interaction.options.getChannel(
        "canal"
      );

    if (disable) {
      d.inviteChannel = null;
      saveData();

      return interaction.reply({
        content:
          "🔗 Mensajes de invitaciones desactivados.",
        ephemeral: true
      });
    }

    if (!channel) {
      return interaction.reply({
        content:
          "❌ Selecciona un canal.",
        ephemeral: true
      });
    }

    d.inviteChannel = channel.id;

    saveData();

    return interaction.reply({
      content:
        `🔗 Las nuevas invitaciones aparecerán en ${channel}.`,
      ephemeral: true
    });
  }

  if (cmd === "invites") {
    const user =
      interaction.options.getUser(
        "usuario"
      ) ||
      interaction.user;

    const stats =
      inviteStats(
        d,
        user.id
      );

    const inside =
      stats.members.filter(id =>
        interaction.guild.members.cache.has(
          id
        )
      );

    const list =
      inside.length
        ? inside
            .slice(0, 30)
            .map(
              (id, index) =>
                `${index + 1}. <@${id}>`
            )
            .join("\n")
        : "Ninguno registrado.";

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle(
            `🔗🃏 Invitaciones de ${user.username}`
          )
          .setThumbnail(
            user.displayAvatarURL()
          )
          .addFields(
            {
              name: "🆕 Nuevas",
              value:
                `${stats.joins}`,
              inline: true
            },
            {
              name: "🚪 Salieron",
              value:
                `${stats.leaves}`,
              inline: true
            },
            {
              name: "👥 En servidor",
              value:
                `${inside.length}`,
              inline: true
            },
            {
              name:
                "♟️ Usuarios invitados",
              value: list
            }
          )
          .setFooter({
            text:
              "Fusake registra los invites desde que se activó el sistema."
          })
      ],
      ephemeral: true
    });
  }

  // ====================================================
  // NUEVO /REACROL
  // ====================================================

  if (cmd === "reacrol") {
    const messageId =
      interaction.options.getString(
        "id_mensaje",
        true
      );

    const role =
      interaction.options.getRole(
        "rol",
        true
      );

    const emoji =
      interaction.options.getString(
        "emoji",
        true
      );

    const type =
      interaction.options.getString(
        "tipo",
        true
      );

    const label =
      interaction.options.getString(
        "mensaje",
        true
      );

    if (
      role.position >=
      interaction.guild.members.me.roles.highest.position
    ) {
      return interaction.reply({
        content:
          "❌ Ese rol está por encima del rol de Fusake. Mové el rol de Fusake por encima.",
        ephemeral: true
      });
    }

    const targetMessage =
      await interaction.channel.messages
        .fetch(messageId)
        .catch(() => null);

    if (!targetMessage) {
      return interaction.reply({
        content:
          "❌ No encontré ese mensaje en este canal. Asegurate de copiar correctamente su ID.",
        ephemeral: true
      });
    }

    let panel =
      d.reactionRoles[messageId];

    if (!panel) {
      panel = {
        messageId,
        channelId: interaction.channel.id,
        type,
        options: []
      };

      d.reactionRoles[messageId] = panel;
    }

    if (panel.type !== type) {
      return interaction.reply({
        content:
          `❌ Ese mensaje ya tiene un sistema **${panel.type}**.\nNo podés mezclar MENÚ y BOTONES en el mismo panel.`,
        ephemeral: true
      });
    }

    const alreadyExists =
      panel.options.some(
        option =>
          option.roleId === role.id
      );

    if (alreadyExists) {
      return interaction.reply({
        content:
          "❌ Ese rol ya está agregado en este panel.",
        ephemeral: true
      });
    }

    if (panel.options.length >= 25) {
      return interaction.reply({
        content:
          "❌ Este panel ya llegó al máximo de **25 roles**.",
        ephemeral: true
      });
    }

    panel.options.push({
      roleId: role.id,
      emoji,
      label
    });

    saveData();

    try {
      await updateReactionRoleMessage(
        interaction.guild,
        panel
      );
    } catch (error) {
      panel.options =
        panel.options.filter(
          option =>
            option.roleId !== role.id
        );

      if (!panel.options.length) {
        delete d.reactionRoles[messageId];
      }

      saveData();

      return interaction.reply({
        content:
          `❌ No pude agregar el menú/botón al mensaje.\nRevisa el emoji y el ID del mensaje.\n\nError: \`${error.message}\``,
        ephemeral: true
      });
    }

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle(
            "✅ ROL INTERACTIVO AGREGADO"
          )
          .setDescription(
            `🎭 **Rol:** ${role}
${emoji} **Opción:** ${label}
🎛️ **Tipo:** ${type === "MENU" ? "Menú desplegable" : "Botón"}
🆔 **Mensaje:** \`${messageId}\`

${
  type === "MENU"
    ? "♟️ Los usuarios solo podrán tener **1 rol de este menú**. Si eligen otro, Fusake quitará automáticamente el anterior."
    : "🃏 Los usuarios podrán elegir **todos los roles que quieran**. Si vuelven a pulsar un botón, Fusake les quitará ese rol."
}`
          )
      ],
      ephemeral: true
    });
  }

  // ====================================================
  // SORTEO CON REQUISITOS
  // ====================================================

  if (cmd === "sorteo") {
    const timeText =
      interaction.options.getString(
        "tiempo",
        true
      );

    const winners =
      interaction.options.getInteger(
        "ganadores",
        true
      );

    const prize =
      interaction.options.getString(
        "premio",
        true
      );

    const requirementsText =
      interaction.options.getString(
        "requisitos"
      ) || "";

    const time =
      parseDuration(timeText);

    if (!time) {
      return interaction.reply({
        content:
          "❌ Tiempo inválido. Ejemplos: `30m`, `1h`, `1h30m`, `2d`.",
        ephemeral: true
      });
    }

    const parsedRequirements =
      parseRequirements(requirementsText);

    if (
      requirementsText &&
      !parsedRequirements.invites &&
      !parsedRequirements.messages
    ) {
      return interaction.reply({
        content:
          "❌ No entendí los requisitos.\n\nEjemplos:\n`5 invites`\n`1000 mensajes`\n`5 invites, 1000 mensajes`",
        ephemeral: true
      });
    }

    try {
      const giveaway =
        await createGiveaway(
          interaction.guild,
          interaction.channel,
          interaction.user.id,
          time,
          winners,
          prize,
          requirementsText
        );

      return interaction.reply({
        content:
          `🎉 Sorteo creado.\n🆔 ID: \`${giveaway.id}\``,
        ephemeral: true
      });
    } catch {
      return interaction.reply({
        content:
          "❌ No pude crear el sorteo.",
        ephemeral: true
      });
    }
  }

  if (cmd === "sorteo-end") {
    const id =
      interaction.options.getString(
        "id",
        true
      );

    await interaction.deferReply({
      ephemeral: true
    });

    const result =
      await endGiveaway(
        interaction.guild,
        id
      );

    return interaction.editReply(
      result.ok
        ? "🎉 Sorteo finalizado."
        : result.message
    );
  }

  if (cmd === "sorteo-reroll") {
    const id =
      interaction.options.getString(
        "id",
        true
      );

    await interaction.deferReply({
      ephemeral: true
    });

    const result =
      await endGiveaway(
        interaction.guild,
        id,
        true
      );

    return interaction.editReply(
      result.ok
        ? "🔄 Nuevos ganadores seleccionados."
        : result.message
    );
  }

  if (cmd === "ban") {
    const user =
      interaction.options.getUser(
        "usuario",
        true
      );

    const reason =
      interaction.options.getString(
        "razon"
      ) ||
      "Sin razón especificada";

    const member =
      await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);

    if (!member) {
      return interaction.reply({
        content:
          "❌ Usuario no encontrado.",
        ephemeral: true
      });
    }

    if (!member.bannable) {
      return interaction.reply({
        content:
          "❌ No puedo banear a ese usuario.",
        ephemeral: true
      });
    }

    try {
      await member.ban({
        reason
      });

      await sendLog(
        interaction.guild,
        "USUARIO BANEADO",
        `**Usuario:** ${user.tag}
**Moderador:** ${interaction.user.tag}
**Razón:** ${reason}`,
        0xe74c3c
      );

      return interaction.reply({
        content:
          `🔨 **${user.tag}** fue baneado.`,
        ephemeral: true
      });
    } catch {
      return interaction.reply({
        content:
          "❌ No pude banear al usuario.",
        ephemeral: true
      });
    }
  }

  if (cmd === "kick") {
    const user =
      interaction.options.getUser(
        "usuario",
        true
      );

    const reason =
      interaction.options.getString(
        "razon"
      ) ||
      "Sin razón especificada";

    const member =
      await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);

    if (!member?.kickable) {
      return interaction.reply({
        content:
          "❌ No puedo expulsar a ese usuario.",
        ephemeral: true
      });
    }

    try {
      await member.kick(reason);

      await sendLog(
        interaction.guild,
        "USUARIO EXPULSADO",
        `**Usuario:** ${user.tag}
**Moderador:** ${interaction.user.tag}
**Razón:** ${reason}`
      );

      return interaction.reply({
        content:
          `🚪 **${user.tag}** fue expulsado.`,
        ephemeral: true
      });
    } catch {
      return interaction.reply({
        content:
          "❌ No pude expulsar al usuario.",
        ephemeral: true
      });
    }
  }

  if (cmd === "timeout") {
    const user =
      interaction.options.getUser(
        "usuario",
        true
      );

    const minutes =
      interaction.options.getInteger(
        "minutos",
        true
      );

    const member =
      await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);

    if (!member?.moderatable) {
      return interaction.reply({
        content:
          "❌ No puedo aplicar timeout a ese usuario.",
        ephemeral: true
      });
    }

    try {
      await member.timeout(
        minutes * 60000,
        `Aplicado por ${interaction.user.tag}`
      );

      return interaction.reply({
        content:
          `⏳ **${user.tag}** recibió timeout de **${minutes} minutos**.`,
        ephemeral: true
      });
    } catch {
      return interaction.reply({
        content:
          "❌ No pude aplicar el timeout.",
        ephemeral: true
      });
    }
  }

  if (cmd === "untimeout") {
    const user =
      interaction.options.getUser(
        "usuario",
        true
      );

    const member =
      await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);

    if (!member?.moderatable) {
      return interaction.reply({
        content:
          "❌ No puedo modificar a ese usuario.",
        ephemeral: true
      });
    }

    try {
      await member.timeout(null);

      return interaction.reply({
        content:
          `🃏 Timeout retirado a **${user.tag}**.`,
        ephemeral: true
      });
    } catch {
      return interaction.reply({
        content:
          "❌ No pude retirar el timeout.",
        ephemeral: true
      });
    }
  }

  if (cmd === "purge") {
    const amount =
      interaction.options.getInteger(
        "cantidad",
        true
      );

    await interaction.deferReply({
      ephemeral: true
    });

    try {
      const deleted =
        await interaction.channel.bulkDelete(
          amount,
          true
        );

      return interaction.editReply(
        `♟️🧹 Se eliminaron **${deleted.size} mensajes**.`
      );
    } catch {
      return interaction.editReply(
        "❌ No pude eliminar los mensajes."
      );
    }
  }

  if (cmd === "serverinfo") {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(
            `♟️🃏 ${interaction.guild.name}`
          )
          .setThumbnail(
            interaction.guild.iconURL()
          )
          .setDescription(
            `👑 Dueño: <@${interaction.guild.ownerId}>
👥 Miembros: ${interaction.guild.memberCount}
💬 Canales: ${interaction.guild.channels.cache.size}
🎭 Roles: ${interaction.guild.roles.cache.size}
😀 Emojis: ${interaction.guild.emojis.cache.size}
🚀 Boosts: ${interaction.guild.premiumSubscriptionCount || 0}`
          )
      ],
      ephemeral: true
    });
  }

  if (cmd === "userinfo") {
    const user =
      interaction.options.getUser(
        "usuario"
      ) ||
      interaction.user;

    const member =
      await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(
            `♟️🃏 ${user.tag}`
          )
          .setThumbnail(
            user.displayAvatarURL()
          )
          .addFields(
            {
              name: "🆔 ID",
              value: user.id,
              inline: true
            },
            {
              name: "📅 Cuenta creada",
              value:
                `<t:${Math.floor(
                  user.createdTimestamp /
                    1000
                )}:F>`
            },
            {
              name: "🏠 Entró al servidor",
              value:
                member?.joinedTimestamp
                  ? `<t:${Math.floor(
                      member.joinedTimestamp /
                        1000
                    )}:F>`
                  : "Desconocido"
            }
          )
      ],
      ephemeral: true
    });
  }
});

// ======================================================
// SERVIDOR HTTP
// ======================================================

const PORT =
  process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type":
        "text/plain; charset=utf-8"
    });

    res.end(
      "♟️🃏 Fusake online"
    );
  })
  .listen(PORT, () => {
    console.log(
      `🌐 Servidor web activo en el puerto ${PORT}`
    );
  });

// ======================================================
// LOGIN
// ======================================================

const TOKEN =
  process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error(
    "❌ Falta la variable DISCORD_TOKEN."
  );

  process.exit(1);
}

client.login(TOKEN);
