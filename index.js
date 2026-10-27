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
  SlashCommandBuilder,
  AttachmentBuilder
} = require("discord.js");

const fs = require("fs");
const http = require("http");

const PREFIX = "b!";
const DATA_FILE = "./welcome-config.json";
const WELCOME_IMAGE = "./redkings-banner.jpeg";
const RED = 0xed1c24;

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
// DATOS
// ======================================================

let data = {};

if (fs.existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    console.error("❌ Error leyendo welcome-config.json:", error);
    data = {};
  }
}

const defaults = () => ({
  welcomeChannel: null,
  goodbyeChannel: null,
  autoRole: null,
  logsChannel: null,
  inviteChannel: null,
  autoReplies: {},
  autoReactions: {},
  warnings: {},
  maintenance: false,
  inviteUsers: {},
  memberInviters: {},
  giveaways: {}
});

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("❌ Error guardando datos:", error);
  }
}

function getGuildData(id) {
  if (!data[id]) {
    data[id] = defaults();
    saveData();
  }

  const def = defaults();

  for (const [key, value] of Object.entries(def)) {
    if (data[id][key] === undefined) {
      data[id][key] = value;
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

  await message.reply({
    content: "🚫 Solo los administradores pueden usar los comandos de Fusake."
  }).catch(() => {});

  return false;
}

async function adminOnlyInteraction(interaction) {
  if (isAdmin(interaction.member)) return true;

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      content: "🚫 Solo los administradores pueden usar esta función.",
      ephemeral: true
    }).catch(() => {});
  } else {
    await interaction.reply({
      content: "🚫 Solo los administradores pueden usar esta función.",
      ephemeral: true
    }).catch(() => {});
  }

  return false;
}

const mentionedMember = message => message.mentions.members.first();
const mentionedRole = message => message.mentions.roles.first();
const mentionedChannel = message => message.mentions.channels.first();

function duration(ms) {
  const seconds = Math.floor(ms / 1000);

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (secs || !parts.length) parts.push(`${secs}s`);

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

  const value = input.replace("#", "").trim();

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
// LOGS ROJOS
// ======================================================

async function sendLog(guild, title, description) {
  const d = getGuildData(guild.id);

  if (!d.logsChannel) return;

  const channel = guild.channels.cache.get(d.logsChannel);

  if (!channel) {
    console.error(`❌ LOGS: No existe el canal ${d.logsChannel}`);
    return;
  }

  if (!channel.isTextBased()) {
    console.error("❌ LOGS: El canal configurado no es de texto.");
    return;
  }

  try {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(RED)
          .setTitle(`♦️♟️ ${title} 🃏`)
          .setDescription(description.slice(0, 4000))
          .setFooter({
            text: "♦️ RED KINGS • ♟️ Fusake 🃏"
          })
          .setTimestamp()
      ]
    });
  } catch (error) {
    console.error(`❌ Error enviando log en #${channel.name}:`, error);
  }
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
    "♦️⚙️ CONFIGURACIÓN",
    "b!bienvenida #canal",
    "b!bienvenida off",
    "b!despedida #canal",
    "b!despedida off",
    "b!invite #canal",
    "b!invite off",
    "b!logs #canal",
    "b!logs off",
    "b!autoroles @rol",
    "b!clearautorole",
    "b!autorespuestas palabra respuesta",
    "b!autoreacciones palabra emoji",
    "b!delreply palabra",
    "b!delreaction palabra",
    "b!maintenance",
    "b!maintenanceon",
    "b!maintenanceoff",
    "b!config",
    "b!resetconfig"
  ],

  servidor: [
    "🏠♟️ SERVIDOR",
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
    "🃏🧰 HERRAMIENTAS DE STAFF",
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
    "🎉🃏 SORTEOS",
    "b!sorteo 1h30m 2 Premio",
    "/sorteo",
    "b!sorteoend ID",
    "/sorteo-end",
    "b!sorteoreroll ID",
    "/sorteo-reroll",
    "",
    "🎉 Botón Participar",
    "👥 Botón Ver participantes"
  ],

  invitaciones: [
    "🔗♦️ INVITACIONES",
    "b!invite #canal",
    "/invite",
    "b!invites @usuario",
    "/invites",
    "",
    "🆕 Nuevas",
    "🚪 Salieron",
    "👥 Siguen en el servidor",
    "📋 Lista de invitados"
  ],

  bot: [
    "🤖♟️ BOT",
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
    .setColor(RED)
    .setTitle("♦️♟️ FUSAKE • PANEL ADMINISTRATIVO 🃏")
    .setDescription(
`╔══════════════════════╗
      ♟️ AJEDREZ + PÓKER 🃏
╚══════════════════════╝

⚡ **Prefijo:** \`${PREFIX}\`
🤖 **Slash:** \`/\`

👑 **Acceso exclusivo para administradores**

♟️ Mueve tus piezas.
🃏 Juega tus cartas.

Selecciona una categoría en el menú.`
    )
    .setFooter({
      text: "♦️ RED KINGS • ♟️ Fusake 🃏"
    })
    .setTimestamp();
}

// ======================================================
// INVITES
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

    console.log(`🔗 Invites cargados: ${guild.name}`);
  } catch (error) {
    console.error(
      `❌ No pude cargar invites de ${guild.name}:`,
      error
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
  } catch (error) {
    console.error("❌ Error detectando invitación:", error);
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
    .setColor(RED)
    .setTitle("🎉♦️ SORTEO • RED KINGS ♟️🃏")
    .setDescription(
`🏆 **Premio**
${giveaway.prize}

👑 **Ganadores:** ${giveaway.winners}
👥 **Participantes:** ${giveaway.participants.length}

⏰ **Finaliza:** <t:${endUnix}:R>
📅 <t:${endUnix}:F>

🎉 Pulsa **Participar** para entrar.`
    )
    .setFooter({
      text: `ID: ${giveaway.id} • ♟️ Fusake 🃏`
    });
}

function selectWinners(giveaway) {
  return shuffle(giveaway.participants)
    .slice(
      0,
      Math.min(
        giveaway.winners,
        giveaway.participants.length
      )
    );
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
            .setColor(RED)
            .setTitle("🎉♦️ SORTEO FINALIZADO")
            .setDescription(
`🏆 **Premio**
${giveaway.prize}

👑 **Ganadores**
${
  winners.length
    ? winners.map(id => `<@${id}>`).join("\n")
    : "No hubo participantes."
}

👥 **Participantes:** ${giveaway.participants.length}`
            )
            .setFooter({
              text: `ID: ${giveaway.id} • ♟️ Fusake 🃏`
            })
            .setTimestamp()
        ],
        components: [giveawayButtons(giveaway.id, true)]
      });
    } catch (error) {
      console.error("❌ Error editando sorteo:", error);
    }

    if (winners.length) {
      await channel.send({
        content:
          `🎊 ¡Felicidades ${winners
            .map(id => `<@${id}>`)
            .join(", ")}! Ganaron **${giveaway.prize}**.`
      }).catch(console.error);
    } else {
      await channel.send({
        content: `🃏 El sorteo de **${giveaway.prize}** terminó sin participantes.`
      }).catch(console.error);
    }

    await sendLog(
      guild,
      "SORTEO FINALIZADO",
      `🏆 **Premio:** ${giveaway.prize}
👥 **Participantes:** ${giveaway.participants.length}
👑 **Ganadores:** ${
        winners.length
          ? winners.map(id => `<@${id}>`).join(", ")
          : "Ninguno"
      }`
    );
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
      await channel.send({
        content:
          `🔄🎉 **Nuevos ganadores de ${giveaway.prize}:** ${winners
            .map(id => `<@${id}>`)
            .join(", ")}`
      }).catch(console.error);
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
  prize
) {
  const d = getGuildData(guild.id);

  const id = Date.now().toString();

  const giveaway = {
    id,
    guildId: guild.id,
    channelId: channel.id,
    messageId: null,
    creatorId,
    prize,
    winners,
    participants: [],
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
    const latest =
      getGuildData(guild.id).giveaways[id];

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
    .setDescription("Panel administrativo de Fusake"),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Muestra la latencia de Fusake"),

  new SlashCommandBuilder()
    .setName("uptime")
    .setDescription("Tiempo encendido"),

  new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription("Información de Fusake"),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Crea un embed personalizado")
    .addStringOption(option =>
      option
        .setName("color")
        .setDescription("Ejemplo: #ff0000")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("mensaje")
        .setDescription("Mensaje")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("bienvenida")
    .setDescription("Configura las bienvenidas")
    .addChannelOption(option =>
      option
        .setName("canal")
        .setDescription("Canal de bienvenida")
        .addChannelTypes(ChannelType.GuildText)
    )
    .addBooleanOption(option =>
      option
        .setName("desactivar")
        .setDescription("Desactivar bienvenidas")
    ),

  new SlashCommandBuilder()
    .setName("despedida")
    .setDescription("Configura las despedidas")
    .addChannelOption(option =>
      option
        .setName("canal")
        .setDescription("Canal de despedidas")
        .addChannelTypes(ChannelType.GuildText)
    )
    .addBooleanOption(option =>
      option
        .setName("desactivar")
        .setDescription("Desactivar despedidas")
    ),

  new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Configura los logs")
    .addChannelOption(option =>
      option
        .setName("canal")
        .setDescription("Canal de logs")
        .addChannelTypes(ChannelType.GuildText)
    )
    .addBooleanOption(option =>
      option
        .setName("desactivar")
        .setDescription("Desactivar logs")
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
        .setDescription("Desactivar autorol")
    ),

  new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Configura mensajes de invitaciones")
    .addChannelOption(option =>
      option
        .setName("canal")
        .setDescription("Canal de invitaciones")
        .addChannelTypes(ChannelType.GuildText)
    )
    .addBooleanOption(option =>
      option
        .setName("desactivar")
        .setDescription("Desactivar mensajes de invitaciones")
    ),

  new SlashCommandBuilder()
    .setName("invites")
    .setDescription("Consulta las invitaciones")
    .addUserOption(option =>
      option
        .setName("usuario")
        .setDescription("Usuario a consultar")
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
        .setDescription("Premio")
        .setRequired(true)
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
    .setDescription("Selecciona nuevos ganadores")
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
    .setDescription("Retira timeout")
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
        .setDescription("Cantidad")
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
          const current =
            getGuildData(guild.id).giveaways[giveaway.id];

          if (current && !current.ended) {
            await endGiveaway(guild, giveaway.id);
          }
        }, remaining);
      }
    }
  }
});

client.on("guildCreate", async guild => {
  getGuildData(guild.id);
  await cacheInvites(guild);
});

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
// BIENVENIDAS + INVITES
// ======================================================

client.on("guildMemberAdd", async member => {
  const d = getGuildData(member.guild.id);

  // AUTOROL
  if (d.autoRole) {
    const role = member.guild.roles.cache.get(d.autoRole);

    if (!role) {
      console.error(`❌ AUTOROL: No existe ${d.autoRole}`);
    } else if (!role.editable) {
      console.error(
        `❌ AUTOROL: Fusake no puede asignar ${role.name}. Revisa la jerarquía.`
      );
    } else {
      try {
        await member.roles.add(role);
      } catch (error) {
        console.error("❌ Error asignando autorol:", error);
      }
    }
  }

  // DETECTAR INVITE
  const usedInvite = await detectInvite(member.guild);

  let inviterId = null;

  if (usedInvite?.inviter) {
    inviterId = usedInvite.inviter.id;

    const stats = inviteStats(d, inviterId);

    stats.joins++;

    if (!stats.members.includes(member.id)) {
      stats.members.push(member.id);
    }

    d.memberInviters[member.id] = inviterId;

    saveData();
  }

  // BIENVENIDA
  if (d.welcomeChannel) {
    const channel =
      member.guild.channels.cache.get(d.welcomeChannel);

    if (!channel) {
      console.error(
        `❌ BIENVENIDA: No existe el canal ${d.welcomeChannel}`
      );
    } else if (!channel.isTextBased()) {
      console.error(
        "❌ BIENVENIDA: El canal configurado no es de texto."
      );
    } else {
      try {
        const embed = new EmbedBuilder()
          .setColor(RED)
          .setTitle("♦️ ¡NUEVA PIEZA ENTRA A RED KINGS! ♟️")
          .setDescription(
`👋 ¡Bienvenido/a ${member}!

Has entrado a **―═★❯❯ RƐɗ KɪƝƓS ♦ .! .**

♟️ **Mueve tus piezas con estrategia.**
🃏 **Juega tus cartas con inteligencia.**

Esperamos que disfrutes de nuestra comunidad. ♥️

♣️ Pásate por <#1533949497812586646> <#1516922343195148520> <#1523782602379624662> para saber más.

👥 Ahora somos **${member.guild.memberCount} miembros**.

♟️ **Tu próximo movimiento puede cambiar la partida.** 🃏`
          )
          .setThumbnail(
            member.user.displayAvatarURL({
              size: 256
            })
          )
          .setFooter({
            text: "♦️ RED KINGS • ♟️ Ajedrez + 🃏 Póker"
          })
          .setTimestamp();

        const payload = {
          embeds: [embed],
          allowedMentions: {
            users: [member.id]
          }
        };

        if (fs.existsSync(WELCOME_IMAGE)) {
          const banner = new AttachmentBuilder(WELCOME_IMAGE, {
            name: "redkings-banner.jpeg"
          });

          embed.setImage("attachment://redkings-banner.jpeg");
          payload.files = [banner];
        } else {
          console.error(
            "⚠️ No encontré redkings-banner.jpeg. La bienvenida se enviará sin imagen."
          );
        }

        await channel.send(payload);

        console.log(`✅ Bienvenida enviada: ${member.user.tag}`);
      } catch (error) {
        console.error("❌ Error enviando bienvenida:", error);
      }
    }
  }

  // MENSAJE DE INVITACIÓN
  if (d.inviteChannel) {
    const channel =
      member.guild.channels.cache.get(d.inviteChannel);

    if (!channel) {
      console.error(
        `❌ INVITES: No existe el canal ${d.inviteChannel}`
      );
    } else if (!channel.isTextBased()) {
      console.error(
        "❌ INVITES: El canal configurado no es de texto."
      );
    } else {
      try {
        if (inviterId) {
          const stats = inviteStats(d, inviterId);

          const currentMembers =
            stats.members.filter(id =>
              member.guild.members.cache.has(id)
            ).length;

          await channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(RED)
                .setTitle("♦️🔗 NUEVA INVITACIÓN ♟️🃏")
                .setDescription(
`👋 ${member} se ha unido a **${member.guild.name}**

♟️ **Invitado por:** <@${inviterId}>

🆕 **Nuevas:** ${stats.joins}
🚪 **Salieron:** ${stats.leaves}
👥 **Siguen en el servidor:** ${currentMembers}

🏰 **Miembros totales:** ${member.guild.memberCount}

♦️ **Una nueva pieza entra en la partida.**`
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setFooter({
                  text: "♦️ RED KINGS • Sistema de invitaciones"
                })
                .setTimestamp()
            ]
          });
        } else {
          await channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(RED)
                .setTitle("♦️🔗 NUEVO MIEMBRO")
                .setDescription(
`${member} se ha unido a **${member.guild.name}**.

⚠️ Fusake no pudo determinar qué invitación utilizó.

👥 **Miembros totales:** ${member.guild.memberCount}`
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp()
            ]
          });
        }

        console.log(`✅ Invite registrado: ${member.user.tag}`);
      } catch (error) {
        console.error("❌ Error enviando invite:", error);
      }
    }
  }

  await sendLog(
    member.guild,
    "MIEMBRO ENTRÓ",
    `👤 **Usuario:** ${member.user.tag}
🆔 **ID:** ${member.id}
🔗 **Invitado por:** ${
      inviterId ? `<@${inviterId}>` : "No detectado"
    }
👥 **Miembros:** ${member.guild.memberCount}`
  );
});

// ======================================================
// DESPEDIDAS
// ======================================================

client.on("guildMemberRemove", async member => {
  const d = getGuildData(member.guild.id);

  const inviterId = d.memberInviters[member.id];

  if (inviterId) {
    const stats = inviteStats(d, inviterId);

    stats.leaves++;

    saveData();

    if (d.inviteChannel) {
      const inviteChannel =
        member.guild.channels.cache.get(d.inviteChannel);

      if (inviteChannel?.isTextBased()) {
        try {
          const currentMembers =
            stats.members.filter(id =>
              member.guild.members.cache.has(id)
            ).length;

          await inviteChannel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(RED)
                .setTitle("♦️🚪 UN INVITADO ABANDONÓ LA MESA")
                .setDescription(
`👤 **${member.user.tag}** salió del servidor.

♟️ **Fue invitado por:** <@${inviterId}>

🆕 **Nuevas:** ${stats.joins}
🚪 **Salieron:** ${stats.leaves}
👥 **Siguen dentro:** ${currentMembers}

♦️ Una pieza abandona el tablero.`
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp()
            ]
          });
        } catch (error) {
          console.error(
            "❌ Error enviando salida en invites:",
            error
          );
        }
      }
    }
  }

  if (d.goodbyeChannel) {
    const channel =
      member.guild.channels.cache.get(d.goodbyeChannel);

    if (!channel) {
      console.error(
        `❌ DESPEDIDA: No existe el canal ${d.goodbyeChannel}`
      );
    } else if (!channel.isTextBased()) {
      console.error(
        "❌ DESPEDIDA: El canal configurado no es de texto."
      );
    } else {
      try {
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(RED)
              .setTitle("♦️🚪 UNA PIEZA ABANDONA RED KINGS")
              .setDescription(
`👋 **${member.user.tag}** ha abandonado **${member.guild.name}**.

♟️ Una pieza menos en el tablero.
🃏 Una carta menos sobre la mesa.

Esperamos volver a verte en otra partida. ♥️

👥 Ahora somos **${member.guild.memberCount} miembros**.`
              )
              .setThumbnail(member.user.displayAvatarURL())
              .setFooter({
                text: "♦️ RED KINGS • ♟️ Ajedrez + 🃏 Póker"
              })
              .setTimestamp()
          ]
        });

        console.log(`✅ Despedida enviada: ${member.user.tag}`);
      } catch (error) {
        console.error("❌ Error enviando despedida:", error);
      }
    }
  }

  await sendLog(
    member.guild,
    "MIEMBRO SALIÓ",
    `👤 **Usuario:** ${member.user.tag}
🆔 **ID:** ${member.id}
♟️ **Invitado por:** ${
      inviterId ? `<@${inviterId}>` : "No registrado"
    }
👥 **Miembros:** ${member.guild.memberCount}`
  );
});

// ======================================================
// LOGS AUTOMÁTICOS
// ======================================================

client.on("messageDelete", async message => {
  if (!message.guild || message.author?.bot) return;

  await sendLog(
    message.guild,
    "MENSAJE ELIMINADO",
    `👤 **Usuario:** ${
      message.author?.tag || "Desconocido"
    }
💬 **Canal:** ${message.channel}
📝 **Mensaje:**
${message.content?.slice(0, 1500) || "*Sin contenido disponible*"}`
  );
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;

  if (oldMessage.content === newMessage.content) return;

  await sendLog(
    newMessage.guild,
    "MENSAJE EDITADO",
    `👤 **Usuario:** ${
      newMessage.author?.tag || "Desconocido"
    }
💬 **Canal:** ${newMessage.channel}

**Antes:**
${oldMessage.content?.slice(0, 1000) || "*No disponible*"}

**Después:**
${newMessage.content?.slice(0, 1000) || "*No disponible*"}`
  );
});

client.on("channelCreate", async channel => {
  if (!channel.guild) return;

  await sendLog(
    channel.guild,
    "CANAL CREADO",
    `💬 **Canal:** ${channel}
🆔 **ID:** ${channel.id}`
  );
});

client.on("channelDelete", async channel => {
  if (!channel.guild) return;

  await sendLog(
    channel.guild,
    "CANAL ELIMINADO",
    `💬 **Nombre:** ${channel.name}
🆔 **ID:** ${channel.id}`
  );
});

client.on("roleCreate", async role => {
  await sendLog(
    role.guild,
    "ROL CREADO",
    `🎭 **Rol:** ${role}
🆔 **ID:** ${role.id}`
  );
});

client.on("roleDelete", async role => {
  await sendLog(
    role.guild,
    "ROL ELIMINADO",
    `🎭 **Nombre:** ${role.name}
🆔 **ID:** ${role.id}`
  );
});

// ======================================================
// COMANDOS b!
// ======================================================

client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;

  const d = getGuildData(message.guild.id);
  const lower = message.content.toLowerCase();

  if (d.autoReplies?.[lower]) {
    await message.channel.send({
      content: d.autoReplies[lower],
      allowedMentions: {
        parse: []
      }
    }).catch(console.error);
  }

  if (d.autoReactions?.[lower]) {
    await message.react(d.autoReactions[lower]).catch(console.error);
  }

  if (!message.content.startsWith(PREFIX)) return;

  const args =
    message.content
      .slice(PREFIX.length)
      .trim()
      .split(/\s+/);

  const cmd = args.shift()?.toLowerCase();

  if (!cmd) return;

  if (!(await adminOnlyMessage(message))) return;

  const reply = content => message.reply(content);

  // HELP
  if (cmd === "help" || cmd === "ayuda") {
    return reply({
      embeds: [helpEmbed()],
      components: [helpMenu()]
    });
  }

  // BIENVENIDA
  if (cmd === "bienvenida") {
    if (args[0]?.toLowerCase() === "off") {
      d.welcomeChannel = null;
      saveData();

      return reply("♦️ Bienvenidas desactivadas.");
    }

    const channel = mentionedChannel(message);

    if (!channel?.isTextBased()) {
      return reply(
        "❌ Usa **b!bienvenida #canal** o **b!bienvenida off**"
      );
    }

    d.welcomeChannel = channel.id;
    saveData();

    return reply(
      `♦️👋 Bienvenidas configuradas en ${channel}.`
    );
  }

  // DESPEDIDA
  if (cmd === "despedida") {
    if (args[0]?.toLowerCase() === "off") {
      d.goodbyeChannel = null;
      saveData();

      return reply("♦️ Despedidas desactivadas.");
    }

    const channel = mentionedChannel(message);

    if (!channel?.isTextBased()) {
      return reply(
        "❌ Usa **b!despedida #canal** o **b!despedida off**"
      );
    }

    d.goodbyeChannel = channel.id;
    saveData();

    return reply(
      `♦️🚪 Despedidas configuradas en ${channel}.`
    );
  }

  // INVITE CHANNEL
  if (cmd === "invite") {
    if (args[0]?.toLowerCase() === "off") {
      d.inviteChannel = null;
      saveData();

      return reply("🔗 Mensajes de invitaciones desactivados.");
    }

    const channel = mentionedChannel(message);

    if (!channel?.isTextBased()) {
      return reply(
        "❌ Usa **b!invite #canal** o **b!invite off**"
      );
    }

    d.inviteChannel = channel.id;

    saveData();

    await cacheInvites(message.guild);

    return reply(
      `♦️🔗 Mensajes de invitaciones configurados en ${channel}.`
    );
  }

  // INVITES
  if (cmd === "invites") {
    const member =
      mentionedMember(message) || message.member;

    const stats = inviteStats(d, member.id);

    const inside =
      stats.members.filter(id =>
        message.guild.members.cache.has(id)
      );

    const list =
      inside.length
        ? inside
            .slice(0, 30)
            .map((id, index) => `${index + 1}. <@${id}>`)
            .join("\n")
        : "Ninguno registrado.";

    return reply({
      embeds: [
        new EmbedBuilder()
          .setColor(RED)
          .setTitle(`♦️🔗 Invitaciones de ${member.user.username}`)
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
              name: "👥 En servidor",
              value: `${inside.length}`,
              inline: true
            },
            {
              name: "♟️ Usuarios invitados",
              value: list
            }
          )
          .setFooter({
            text: "♦️ Fusake • Sistema de invitaciones"
          })
          .setTimestamp()
      ]
    });
  }

  // AUTOROL
  if (cmd === "autoroles" || cmd === "setautorole") {
    if (args[0]?.toLowerCase() === "off") {
      d.autoRole = null;
      saveData();

      return reply("🎭 Autorol desactivado.");
    }

    const role = mentionedRole(message);

    if (!role) {
      return reply("❌ Usa **b!autoroles @rol**");
    }

    if (
      role.position >=
      message.guild.members.me.roles.highest.position
    ) {
      return reply(
        "❌ Ese rol está por encima del rol de Fusake."
      );
    }

    d.autoRole = role.id;
    saveData();

    return reply(`🎭 Autorol configurado: ${role}.`);
  }

  if (cmd === "clearautorole") {
    d.autoRole = null;
    saveData();

    return reply("🎭 Autorol eliminado.");
  }

  // LOGS
  if (cmd === "logs" || cmd === "setlog") {
    if (args[0]?.toLowerCase() === "off") {
      d.logsChannel = null;
      saveData();

      return reply("♦️📋 Logs desactivados.");
    }

    const channel = mentionedChannel(message);

    if (!channel?.isTextBased()) {
      return reply(
        "❌ Usa **b!logs #canal** o **b!logs off**"
      );
    }

    d.logsChannel = channel.id;
    saveData();

    await reply(`♦️📋 Logs configurados en ${channel}.`);

    await sendLog(
      message.guild,
      "SISTEMA DE LOGS ACTIVADO",
      `👑 **Configurado por:** ${message.author}
📋 **Canal:** ${channel}

♦️ Los eventos administrativos aparecerán aquí.`
    );

    return;
  }

  if (cmd === "clearlogs") {
    d.logsChannel = null;
    saveData();

    return reply("📋 Canal de logs eliminado.");
  }

  // MAINTENANCE
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

  // CONFIG
  if (cmd === "config") {
    return reply({
      embeds: [
        new EmbedBuilder()
          .setColor(RED)
          .setTitle("♦️♟️ Configuración de Fusake 🃏")
          .addFields(
            {
              name: "👋 Bienvenida",
              value:
                d.welcomeChannel
                  ? `<#${d.welcomeChannel}>`
                  : "Desactivada",
              inline: true
            },
            {
              name: "🚪 Despedida",
              value:
                d.goodbyeChannel
                  ? `<#${d.goodbyeChannel}>`
                  : "Desactivada",
              inline: true
            },
            {
              name: "🔗 Invitaciones",
              value:
                d.inviteChannel
                  ? `<#${d.inviteChannel}>`
                  : "Desactivadas",
              inline: true
            },
            {
              name: "📋 Logs",
              value:
                d.logsChannel
                  ? `<#${d.logsChannel}>`
                  : "Desactivados",
              inline: true
            },
            {
              name: "🎭 Autorol",
              value:
                d.autoRole
                  ? `<@&${d.autoRole}>`
                  : "Desactivado",
              inline: true
            },
            {
              name: "🔧 Mantenimiento",
              value:
                d.maintenance
                  ? "Activado"
                  : "Desactivado",
              inline: true
            }
          )
          .setTimestamp()
      ]
    });
  }

  if (cmd === "resetconfig") {
    data[message.guild.id] = defaults();
    saveData();

    return reply("♻️ Configuración reiniciada.");
  }

  // AUTO RESPUESTAS / REACCIONES
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
      return reply("❌ Indica una palabra.");
    }

    delete d[key][trigger];
    saveData();

    return reply("🗑️ Configuración eliminada.");
  }

  // BAN / KICK
  if (cmd === "ban" || cmd === "kick") {
    const member = mentionedMember(message);

    if (!member) {
      return reply(
        `❌ Usa **b!${cmd} @usuario [razón]**`
      );
    }

    const reason =
      args.slice(1).join(" ") ||
      "Sin razón especificada";

    try {
      if (cmd === "ban") {
        if (!member.bannable) {
          return reply(
            "❌ No puedo banear a ese usuario. Revisa la jerarquía."
          );
        }

        await member.ban({ reason });
      } else {
        if (!member.kickable) {
          return reply(
            "❌ No puedo expulsar a ese usuario."
          );
        }

        await member.kick(reason);
      }

      await sendLog(
        message.guild,
        cmd === "ban"
          ? "USUARIO BANEADO"
          : "USUARIO EXPULSADO",
        `👤 **Usuario:** ${member.user.tag}
👑 **Moderador:** ${message.author.tag}
📝 **Razón:** ${reason}`
      );

      return reply(
        `${cmd === "ban" ? "🔨" : "🚪"} **${member.user.tag}**
📝 **Razón:** ${reason}`
      );
    } catch (error) {
      console.error(error);

      return reply(
        "❌ No pude realizar esa acción."
      );
    }
  }

  // UNBAN
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
        `👤 **Usuario:** ${user.tag}
👑 **Moderador:** ${message.author.tag}`
      );

      return reply(
        `🔓 **${user.tag}** fue desbaneado.`
      );
    } catch {
      return reply(
        "❌ No pude desbanear ese ID."
      );
    }
  }

  // SOFTBAN
  if (cmd === "softban") {
    const member = mentionedMember(message);

    if (!member) {
      return reply(
        "❌ Usa **b!softban @usuario [razón]**"
      );
    }

    if (!member.bannable) {
      return reply(
        "❌ No puedo aplicar softban a ese usuario."
      );
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
        `👤 **Usuario:** ${member.user.tag}
👑 **Moderador:** ${message.author.tag}
📝 **Razón:** ${reason}`
      );

      return reply(
        `♟️ Softban aplicado a **${member.user.tag}**.`
      );
    } catch {
      return reply("❌ No pude aplicar el softban.");
    }
  }

  // TIMEOUT
  if (cmd === "timeout" || cmd === "untimeout") {
    const member = mentionedMember(message);

    if (!member) {
      return reply("❌ Debes mencionar un usuario.");
    }

    if (!member.moderatable) {
      return reply(
        "❌ No puedo moderar a ese usuario."
      );
    }

    try {
      if (cmd === "untimeout") {
        await member.timeout(
          null,
          `Retirado por ${message.author.tag}`
        );

        await sendLog(
          message.guild,
          "TIMEOUT RETIRADO",
          `👤 **Usuario:** ${member.user.tag}
👑 **Moderador:** ${message.author.tag}`
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
        "TIMEOUT APLICADO",
        `👤 **Usuario:** ${member.user.tag}
⏰ **Duración:** ${minutes} minutos
👑 **Moderador:** ${message.author.tag}`
      );

      return reply(
        `⏳ **${member.user.tag}** recibió timeout de **${minutes} minutos**.`
      );
    } catch {
      return reply(
        "❌ No pude modificar el timeout."
      );
    }
  }

  // WARNINGS
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
        `👤 **Usuario:** ${member.user.tag}
👑 **Moderador:** ${message.author.tag}
📝 **Razón:** ${reason}`
      );

      return reply(
        `⚠️ **${member.user.tag}** recibió una advertencia.`
      );
    }

    if (cmd === "clearwarnings") {
      delete d.warnings[member.id];

      saveData();

      await sendLog(
        message.guild,
        "ADVERTENCIAS ELIMINADAS",
        `👤 **Usuario:** ${member.user.tag}
👑 **Moderador:** ${message.author.tag}`
      );

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

  // PURGE
  if (
    cmd === "purge" ||
    cmd === "clear" ||
    cmd === "clearchannel"
  ) {
    const amount =
      Number(args[0]) ||
      (cmd === "clearchannel" ? 50 : 0);

    if (amount < 1 || amount > 100) {
      return reply(
        "❌ Usa una cantidad entre **1 y 100**."
      );
    }

    try {
      const deleted =
        await message.channel.bulkDelete(amount, true);

      await sendLog(
        message.guild,
        "MENSAJES ELIMINADOS",
        `👑 **Moderador:** ${message.author.tag}
💬 **Canal:** ${message.channel}
🧹 **Cantidad:** ${deleted.size}`
      );

      return message.channel.send(
        `♟️🧹 Se limpiaron **${deleted.size} mensajes**.`
      );
    } catch {
      return reply("❌ No pude limpiar el canal.");
    }
  }

  // LOCK / UNLOCK
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

      await sendLog(
        message.guild,
        cmd === "lock"
          ? "CANAL BLOQUEADO"
          : "CANAL DESBLOQUEADO",
        `💬 **Canal:** ${message.channel}
👑 **Administrador:** ${message.author.tag}`
      );

      return reply(
        cmd === "lock"
          ? "🔒 Canal bloqueado."
          : "🔓 Canal desbloqueado."
      );
    } catch {
      return reply(
        "❌ No pude cambiar los permisos del canal."
      );
    }
  }

  // LOCKALL / UNLOCKALL
  if (cmd === "lockall" || cmd === "unlockall") {
    let changed = 0;

    for (const channel of message.guild.channels.cache.values()) {
      if (
        channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement
      ) {
        continue;
      }

      try {
        await channel.permissionOverwrites.edit(
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

    await sendLog(
      message.guild,
      cmd === "lockall"
        ? "SERVIDOR BLOQUEADO"
        : "SERVIDOR DESBLOQUEADO",
      `👑 **Administrador:** ${message.author.tag}
💬 **Canales modificados:** ${changed}`
    );

    return reply(
      `${
        cmd === "lockall"
          ? "🔒"
          : "🔓"
      } Se actualizaron **${changed} canales**.`
    );
  }

  // SLOWMODE
  if (cmd === "slowmode") {
    const seconds = Number(args[0]);

    if (
      Number.isNaN(seconds) ||
      seconds < 0 ||
      seconds > 21600
    ) {
      return reply(
        "❌ Usa un valor entre **0 y 21600 segundos**."
      );
    }

    try {
      await message.channel.setRateLimitPerUser(seconds);

      return reply(
        `🐌 Slowmode establecido en **${seconds} segundos**.`
      );
    } catch {
      return reply(
        "❌ No pude modificar el slowmode."
      );
    }
  }

  // NICK
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

      return reply(
        `✏️ Apodo actualizado a **${name}**.`
      );
    } catch {
      return reply(
        "❌ No pude cambiar el apodo."
      );
    }
  }

  // DEHOIST
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

      const newName =
        member.displayName.replace(
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

  // ROLEALL
  if (
    cmd === "roleall" ||
    cmd === "removeroleall"
  ) {
    const role = mentionedRole(message);

    if (
      !role ||
      role.position >=
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
          !member.roles.cache.has(role.id)
        ) {
          await member.roles.add(role);
          changed++;
        }

        if (
          cmd === "removeroleall" &&
          member.roles.cache.has(role.id)
        ) {
          await member.roles.remove(role);
          changed++;
        }
      } catch {}
    }

    return reply(
      `🎭 Se modificó el rol en **${changed} usuarios**.`
    );
  }

  // USER INFO
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
          .setColor(RED)
          .setTitle(`♦️♟️ ${member.user.tag}`)
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
              value:
                `<t:${Math.floor(
                  member.user.createdTimestamp / 1000
                )}:F>`
            },
            {
              name: "🏠 Entró",
              value:
                member.joinedTimestamp
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

  // SERVER INFO
  if (cmd === "serverinfo") {
    return reply({
      embeds: [
        new EmbedBuilder()
          .setColor(RED)
          .setTitle(`♦️♟️ ${message.guild.name} 🃏`)
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

  if (cmd === "members" || cmd === "membercount") {
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
          channel =>
            channel.type ===
            ChannelType.GuildCategory
        ).size
      }**`
    );
  }

  if (cmd === "channelcount") {
    return reply(
`♟️ Texto: **${
  message.guild.channels.cache.filter(
    channel =>
      channel.type === ChannelType.GuildText
  ).size
}**
🃏 Voz: **${
  message.guild.channels.cache.filter(
    channel =>
      channel.type === ChannelType.GuildVoice
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
          .setColor(RED)
          .setTitle("♦️♟️ Jugadores de la mesa")
          .setDescription(
            members ||
              "No hay miembros disponibles."
          )
      ]
    });
  }

  // ROLES
  if (cmd === "roles") {
    const roles =
      message.guild.roles.cache
        .filter(role => role.id !== message.guild.id)
        .map(role => role.toString())
        .slice(0, 50)
        .join("\n");

    return reply(
      roles || "No hay roles."
    );
  }

  if (cmd === "roleinfo") {
    const role = mentionedRole(message);

    if (!role) {
      return reply(
        "❌ Usa **b!roleinfo @rol**"
      );
    }

    return reply(
`🃏 **${role.name}**
🆔 ${role.id}
👥 ${role.members.size} miembros
📌 Posición ${role.position}`
    );
  }

  // CHANNEL INFO
  if (cmd === "channelinfo") {
    const channel =
      mentionedChannel(message) ||
      message.channel;

    return reply(
`💬 **${channel.name}**
🆔 ${channel.id}
📂 Tipo: ${channel.type}`
    );
  }

  // ICON / BANNER
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
          .setColor(RED)
          .setTitle(
            cmd === "servericon"
              ? "♦️ Icono del servidor"
              : "♦️ Banner del servidor"
          )
          .setImage(url)
      ]
    });
  }

  // STAFF
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

  // PERMISSIONS
  if (cmd === "permissions") {
    const member =
      mentionedMember(message) ||
      message.member;

    const permissions =
      member.permissions
        .toArray()
        .map(permission => `• ${permission}`)
        .join("\n")
        .slice(0, 1900);

    return reply(
      permissions || "Sin permisos."
    );
  }

  // AVATAR
  if (cmd === "avatar") {
    const member =
      mentionedMember(message) ||
      message.member;

    return reply({
      embeds: [
        new EmbedBuilder()
          .setColor(RED)
          .setTitle(
            `♦️ Avatar de ${member.user.tag}`
          )
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

  // SAY
  if (cmd === "say") {
    const text = args.join(" ");

    if (!text) {
      return reply(
        "❌ Usa **b!say mensaje**"
      );
    }

    await message.delete().catch(() => {});

    return message.channel.send({
      content: text,
      allowedMentions: {
        parse: []
      }
    });
  }

  // ANNOUNCE
  if (cmd === "announce") {
    const text = args.join(" ");

    if (!text) {
      return reply(
        "❌ Usa **b!announce mensaje**"
      );
    }

    return message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(RED)
          .setTitle("♦️♟️ ANUNCIO 🃏")
          .setDescription(text)
          .setTimestamp()
      ]
    });
  }

  // EMBED
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

  // POLL
  if (cmd === "poll") {
    const question = args.join(" ");

    if (!question) {
      return reply(
        "❌ Usa **b!poll pregunta**"
      );
    }

    const poll =
      await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(RED)
            .setTitle("♦️♟️ Encuesta 🃏")
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

  // MOVE / DISCONNECT
  if (cmd === "move" || cmd === "disconnect") {
    const member = mentionedMember(message);

    if (!member) {
      return reply(
        "❌ Debes mencionar un usuario."
      );
    }

    try {
      if (cmd === "move") {
        const channel = mentionedChannel(message);

        if (
          !channel ||
          channel.type !== ChannelType.GuildVoice
        ) {
          return reply(
            "❌ Menciona un canal de voz."
          );
        }

        await member.voice.setChannel(channel);

        return reply(
          `🔊 **${member.user.tag}** fue movido a ${channel}.`
        );
      }

      await member.voice.disconnect();

      return reply(
        `🔇 **${member.user.tag}** fue desconectado.`
      );
    } catch {
      return reply(
        "❌ No pude modificar el canal de voz."
      );
    }
  }

  // ROLES
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
    const role = mentionedRole(message);

    if (
      !member ||
      !role ||
      !["add", "remove"].includes(action)
    ) {
      return reply(
        "❌ Usa **b!role add @usuario @rol** o **b!role remove @usuario @rol**"
      );
    }

    if (
      role.position >=
      message.guild.members.me.roles.highest.position
    ) {
      return reply(
        "❌ Ese rol está por encima de Fusake."
      );
    }

    try {
      if (action === "add") {
        await member.roles.add(role);
      } else {
        await member.roles.remove(role);
      }

      await sendLog(
        message.guild,
        "ROL MODIFICADO",
        `👤 **Usuario:** ${member.user.tag}
🎭 **Rol:** ${role.name}
⚙️ **Acción:** ${
          action === "add"
            ? "Añadido"
            : "Eliminado"
        }
👑 **Administrador:** ${message.author.tag}`
      );

      return reply(
        `🎭 Rol ${role} ${
          action === "add"
            ? "añadido a"
            : "eliminado de"
        } **${member.user.tag}**.`
      );
    } catch {
      return reply(
        "❌ No pude modificar ese rol."
      );
    }
  }

  // STATUS
  if (cmd === "setstatus") {
    const text = args.join(" ");

    if (!text) {
      return reply(
        "❌ Usa **b!setstatus texto**"
      );
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

  // RENAME
  if (cmd === "renamechannel") {
    const name =
      args.join("-").toLowerCase();

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
      return reply(
        "❌ No pude renombrar el canal."
      );
    }
  }

  // DM
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
      return reply(
        "❌ No pude enviar el MD."
      );
    }
  }

  // REACT
  if (cmd === "react") {
    if (!args[0]) {
      return reply(
        "❌ Usa **b!react emoji**"
      );
    }

    try {
      await message.react(args[0]);
      return;
    } catch {
      return reply(
        "❌ No pude añadir esa reacción."
      );
    }
  }

  // CLEARLAST
  if (cmd === "clearlast") {
    const messages =
      await message.channel.messages
        .fetch({
          limit: 10
        })
        .catch(() => null);

    if (!messages) {
      return reply(
        "❌ No pude obtener los mensajes."
      );
    }

    const botMessages =
      messages.filter(
        msg => msg.author.id === client.user.id
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

  // SORTEO
  if (cmd === "sorteo") {
    const timeText = args.shift();
    const winners = Number(args.shift());
    const prize = args.join(" ");

    const time = parseDuration(timeText);

    if (
      !time ||
      !Number.isInteger(winners) ||
      winners < 1 ||
      winners > 50 ||
      !prize
    ) {
      return reply(
        "❌ Usa **b!sorteo 1h30m 2 Premio**"
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
          prize
        );

      await sendLog(
        message.guild,
        "SORTEO CREADO",
        `🏆 **Premio:** ${prize}
👑 **Ganadores:** ${winners}
⏰ **Duración:** ${timeText}
👤 **Creado por:** ${message.author.tag}
🆔 **ID:** ${giveaway.id}`
      );

      return reply(
        `🎉 Sorteo creado.\n🆔 ID: \`${giveaway.id}\``
      );
    } catch (error) {
      console.error(error);

      return reply(
        "❌ No pude crear el sorteo."
      );
    }
  }

  if (cmd === "sorteoend") {
    const id = args[0];

    if (!id) {
      return reply(
        "❌ Usa **b!sorteoend ID**"
      );
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
      return reply(
        "❌ Usa **b!sorteoreroll ID**"
      );
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

  // BOT AVATAR
  if (cmd === "botavatar") {
    if (!args[0]) {
      return reply(
        "❌ Usa **b!botavatar URL**"
      );
    }

    try {
      await client.user.setAvatar(args[0]);

      return reply(
        "♦️ Avatar de Fusake actualizado."
      );
    } catch {
      return reply(
        "❌ No pude cambiar el avatar."
      );
    }
  }

  // BOT NAME
  if (cmd === "botname") {
    const name = args.join(" ");

    if (!name) {
      return reply(
        "❌ Usa **b!botname nombre**"
      );
    }

    try {
      await client.user.setUsername(name);

      return reply(
        "🃏 Nombre del bot cambiado."
      );
    } catch {
      return reply(
        "❌ No pude cambiar el nombre."
      );
    }
  }

  // RESTART
  if (cmd === "restart") {
    await reply(
      "♟️ Fusake se está reiniciando..."
    );

    setTimeout(
      () => process.exit(0),
      1500
    );

    return;
  }

  // SERVERLIST
  if (cmd === "serverlist") {
    const list =
      client.guilds.cache
        .map(
          guild =>
            `♟️ **${guild.name}** — ${guild.memberCount} miembros`
        )
        .join("\n")
        .slice(0, 1900);

    return reply(
      list || "Sin servidores."
    );
  }

  // MEMORY
  if (cmd === "memory") {
    const memory = process.memoryUsage();

    return reply(
`🧠 RAM utilizada: **${Math.round(
  memory.heapUsed / 1024 / 1024
)} MB**
📦 Heap total: **${Math.round(
  memory.heapTotal / 1024 / 1024
)} MB**`
    );
  }

  // BOT INFO
  if (cmd === "botinfo") {
    return reply(
`♦️♟️ **${client.user.tag}** 🃏

🌐 Servidores: ${client.guilds.cache.size}
📡 Ping: ${client.ws.ping}ms
⚡ Prefijo: ${PREFIX}
🤖 Slash: /`
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
    `❓ Comando desconocido. Usa **${PREFIX}help**.`
  );
});

// ======================================================
// INTERACCIONES
// ======================================================

client.on("interactionCreate", async interaction => {
  if (!interaction.guild) return;

  // HELP MENU
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "fusake_help"
  ) {
    if (!(await adminOnlyInteraction(interaction))) return;

    const selected =
      help[interaction.values[0]];

    if (!selected) {
      return interaction.reply({
        content: "❌ Categoría no encontrada.",
        ephemeral: true
      });
    }

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(RED)
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
            text: "♦️♟️ Fusake • Solo administradores 🃏"
          })
          .setTimestamp()
      ],
      ephemeral: true
    });
  }

  // BOTONES DE SORTEO
  if (interaction.isButton()) {
    if (
      interaction.customId.startsWith("giveaway_join:")
    ) {
      const id =
        interaction.customId.split(":")[1];

      const d =
        getGuildData(interaction.guild.id);

      const giveaway =
        d.giveaways[id];

      if (!giveaway) {
        return interaction.reply({
          content: "❌ Este sorteo ya no existe.",
          ephemeral: true
        });
      }

      if (giveaway.ended) {
        return interaction.reply({
          content: "❌ Este sorteo ya terminó.",
          ephemeral: true
        });
      }

      if (
        giveaway.participants.includes(
          interaction.user.id
        )
      ) {
        giveaway.participants =
          giveaway.participants.filter(
            userId =>
              userId !== interaction.user.id
          );

        saveData();

        try {
          await interaction.message.edit({
            embeds: [giveawayEmbed(giveaway)],
            components: [giveawayButtons(giveaway.id)]
          });
        } catch {}

        return interaction.reply({
          content: "🚪 Saliste del sorteo.",
          ephemeral: true
        });
      }

      giveaway.participants.push(
        interaction.user.id
      );

      saveData();

      try {
        await interaction.message.edit({
          embeds: [giveawayEmbed(giveaway)],
          components: [giveawayButtons(giveaway.id)]
        });
      } catch {}

      return interaction.reply({
        content:
          `🎉 ¡Ya estás participando por **${giveaway.prize}**!`,
        ephemeral: true
      });
    }

    if (
      interaction.customId.startsWith("giveaway_users:")
    ) {
      const id =
        interaction.customId.split(":")[1];

      const d =
        getGuildData(interaction.guild.id);

      const giveaway =
        d.giveaways[id];

      if (!giveaway) {
        return interaction.reply({
          content: "❌ Sorteo no encontrado.",
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
            .setColor(RED)
            .setTitle("♦️👥 Participantes")
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

  if (!interaction.isChatInputCommand()) return;

  if (!(await adminOnlyInteraction(interaction))) return;

  const d =
    getGuildData(interaction.guild.id);

  const cmd = interaction.commandName;

  // HELP
  if (cmd === "help") {
    return interaction.reply({
      embeds: [helpEmbed()],
      components: [helpMenu()],
      ephemeral: true
    });
  }

  if (cmd === "ping") {
    return interaction.reply({
      content: `🏓 Pong! **${client.ws.ping}ms**`,
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
`♦️♟️ **${client.user.tag}** 🃏

🌐 Servidores: ${client.guilds.cache.size}
📡 Ping: ${client.ws.ping}ms
⚡ Prefijo: ${PREFIX}
🤖 Slash: /`,
      ephemeral: true
    });
  }

  // EMBED
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
      content: "✅ Embed enviado.",
      ephemeral: true
    });
  }

  // BIENVENIDA
  if (cmd === "bienvenida") {
    const disable =
      interaction.options.getBoolean("desactivar");

    const channel =
      interaction.options.getChannel("canal");

    if (disable) {
      d.welcomeChannel = null;
      saveData();

      return interaction.reply({
        content: "♦️ Bienvenidas desactivadas.",
        ephemeral: true
      });
    }

    if (!channel) {
      return interaction.reply({
        content:
          "❌ Selecciona un canal o activa `desactivar`.",
        ephemeral: true
      });
    }

    d.welcomeChannel = channel.id;
    saveData();

    return interaction.reply({
      content:
        `♦️👋 Bienvenidas configuradas en ${channel}.`,
      ephemeral: true
    });
  }

  // DESPEDIDA
  if (cmd === "despedida") {
    const disable =
      interaction.options.getBoolean("desactivar");

    const channel =
      interaction.options.getChannel("canal");

    if (disable) {
      d.goodbyeChannel = null;
      saveData();

      return interaction.reply({
        content: "♦️ Despedidas desactivadas.",
        ephemeral: true
      });
    }

    if (!channel) {
      return interaction.reply({
        content:
          "❌ Selecciona un canal o activa `desactivar`.",
        ephemeral: true
      });
    }

    d.goodbyeChannel = channel.id;
    saveData();

    return interaction.reply({
      content:
        `♦️🚪 Despedidas configuradas en ${channel}.`,
      ephemeral: true
    });
  }

  // LOGS
  if (cmd === "logs") {
    const disable =
      interaction.options.getBoolean("desactivar");

    const channel =
      interaction.options.getChannel("canal");

    if (disable) {
      d.logsChannel = null;
      saveData();

      return interaction.reply({
        content: "📋 Logs desactivados.",
        ephemeral: true
      });
    }

    if (!channel) {
      return interaction.reply({
        content: "❌ Selecciona un canal.",
        ephemeral: true
      });
    }

    d.logsChannel = channel.id;
    saveData();

    await interaction.reply({
      content:
        `♦️📋 Logs configurados en ${channel}.`,
      ephemeral: true
    });

    await sendLog(
      interaction.guild,
      "SISTEMA DE LOGS ACTIVADO",
      `👑 **Administrador:** ${interaction.user}
📋 **Canal:** ${channel}`
    );

    return;
  }

  // AUTOROLE
  if (cmd === "autorole") {
    const disable =
      interaction.options.getBoolean("desactivar");

    const role =
      interaction.options.getRole("rol");

    if (disable) {
      d.autoRole = null;
      saveData();

      return interaction.reply({
        content: "🎭 Autorol desactivado.",
        ephemeral: true
      });
    }

    if (!role) {
      return interaction.reply({
        content: "❌ Selecciona un rol.",
        ephemeral: true
      });
    }

    if (
      role.position >=
      interaction.guild.members.me.roles.highest.position
    ) {
      return interaction.reply({
        content:
          "❌ Ese rol está por encima de Fusake.",
        ephemeral: true
      });
    }

    d.autoRole = role.id;
    saveData();

    return interaction.reply({
      content: `🎭 Autorol configurado: ${role}.`,
      ephemeral: true
    });
  }

  // INVITE
  if (cmd === "invite") {
    const disable =
      interaction.options.getBoolean("desactivar");

    const channel =
      interaction.options.getChannel("canal");

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
        content: "❌ Selecciona un canal.",
        ephemeral: true
      });
    }

    d.inviteChannel = channel.id;
    saveData();

    await cacheInvites(interaction.guild);

    return interaction.reply({
      content:
        `♦️🔗 Invitaciones configuradas en ${channel}.`,
      ephemeral: true
    });
  }

  // INVITES STATS
  if (cmd === "invites") {
    const user =
      interaction.options.getUser("usuario") ||
      interaction.user;

    const stats =
      inviteStats(d, user.id);

    const inside =
      stats.members.filter(id =>
        interaction.guild.members.cache.has(id)
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
          .setColor(RED)
          .setTitle(
            `♦️🔗 Invitaciones de ${user.username}`
          )
          .setThumbnail(user.displayAvatarURL())
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
              name: "👥 En servidor",
              value: `${inside.length}`,
              inline: true
            },
            {
              name: "♟️ Usuarios invitados",
              value: list
            }
          )
      ],
      ephemeral: true
    });
  }

  // SORTEO
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

    const time =
      parseDuration(timeText);

    if (!time) {
      return interaction.reply({
        content:
          "❌ Tiempo inválido. Ejemplos: `30m`, `1h`, `1h30m`, `2d`.",
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
          prize
        );

      await interaction.reply({
        content:
          `🎉 Sorteo creado.\n🆔 ID: \`${giveaway.id}\``,
        ephemeral: true
      });

      await sendLog(
        interaction.guild,
        "SORTEO CREADO",
        `🏆 **Premio:** ${prize}
👑 **Ganadores:** ${winners}
⏰ **Duración:** ${timeText}
👤 **Creado por:** ${interaction.user.tag}`
      );

      return;
    } catch (error) {
      console.error(error);

      return interaction.reply({
        content: "❌ No pude crear el sorteo.",
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

  // BAN
  if (cmd === "ban") {
    const user =
      interaction.options.getUser(
        "usuario",
        true
      );

    const reason =
      interaction.options.getString("razon") ||
      "Sin razón especificada";

    const member =
      await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);

    if (!member?.bannable) {
      return interaction.reply({
        content:
          "❌ No puedo banear a ese usuario.",
        ephemeral: true
      });
    }

    try {
      await member.ban({ reason });

      await sendLog(
        interaction.guild,
        "USUARIO BANEADO",
        `👤 **Usuario:** ${user.tag}
👑 **Moderador:** ${interaction.user.tag}
📝 **Razón:** ${reason}`
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

  // KICK
  if (cmd === "kick") {
    const user =
      interaction.options.getUser(
        "usuario",
        true
      );

    const reason =
      interaction.options.getString("razon") ||
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
        `👤 **Usuario:** ${user.tag}
👑 **Moderador:** ${interaction.user.tag}
📝 **Razón:** ${reason}`
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

  // TIMEOUT
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

      await sendLog(
        interaction.guild,
        "TIMEOUT APLICADO",
        `👤 **Usuario:** ${user.tag}
⏰ **Duración:** ${minutes} minutos
👑 **Moderador:** ${interaction.user.tag}`
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

  // UNTIMEOUT
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

      await sendLog(
        interaction.guild,
        "TIMEOUT RETIRADO",
        `👤 **Usuario:** ${user.tag}
👑 **Moderador:** ${interaction.user.tag}`
      );

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

  // PURGE
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

      await sendLog(
        interaction.guild,
        "MENSAJES ELIMINADOS",
        `👑 **Administrador:** ${interaction.user.tag}
💬 **Canal:** ${interaction.channel}
🧹 **Cantidad:** ${deleted.size}`
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

  // SERVER INFO
  if (cmd === "serverinfo") {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(RED)
          .setTitle(
            `♦️♟️ ${interaction.guild.name} 🃏`
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

  // USER INFO
  if (cmd === "userinfo") {
    const user =
      interaction.options.getUser("usuario") ||
      interaction.user;

    const member =
      await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(RED)
          .setTitle(`♦️♟️ ${user.tag}`)
          .setThumbnail(user.displayAvatarURL())
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
                  user.createdTimestamp / 1000
                )}:F>`
            },
            {
              name: "🏠 Entró al servidor",
              value:
                member?.joinedTimestamp
                  ? `<t:${Math.floor(
                      member.joinedTimestamp / 1000
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
// ERRORES
// ======================================================

client.on("error", error => {
  console.error("❌ Error del cliente Discord:", error);
});

process.on("unhandledRejection", error => {
  console.error("❌ Promesa no manejada:", error);
});

process.on("uncaughtException", error => {
  console.error("❌ Excepción no controlada:", error);
});

// ======================================================
// HTTP
// ======================================================

const PORT =
  process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8"
    });

    res.end("♦️♟️ Fusake online 🃏");
  })
  .listen(PORT, () => {
    console.log(
      `🌐 Servidor web activo en puerto ${PORT}`
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
