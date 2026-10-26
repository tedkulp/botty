# discord.js intents and permissions for reading links and reacting

Research for [#4](https://github.com/tedkulp/botty/issues/4). Researched 2026-10-26 against Discord's developer docs (docs.discord.com/developers) and the discord.js guide/docs.

Question: what does a discord.js bot need in order to read URLs from messages in chosen channels across several servers, react to them, and list guilds/channels in the dashboard?

## TL;DR

- **Gateway intents:** `Guilds`, `GuildMessages`, `MessageContent`. `GuildMessageReactions` is only needed to *receive* reaction events, not to add reactions.
- **MessageContent is privileged.** Below **10,000 unique users** (summed across every server the bot is in) you just turn it on in the Developer Portal. Since **June 10, 2026** the threshold counts users, not the old "100 servers". Past it you have 90 days to apply, and you reapply every year.
- **Channel permissions:** `ViewChannel`, `ReadMessageHistory`, `AddReactions`. `SendMessages` is optional, only if a Module replies.
- **URLs live in** `content`, `embeds[].url` (plus the image/video/thumbnail/author URLs), `attachments[].url`, and `message_snapshots` (forwards). All of these are gated by MessageContent.
- **Dashboard enumeration:** `client.guilds.cache` plus each guild's `channels.cache`, filled by `GUILD_CREATE` (Guilds intent). **From November 16, 2026**, channels the bot can't view come through obfuscated over the gateway (named `___hidden___`), and `GET /guilds/{id}/channels` leaves them out.

## 1. Gateway intents

From [Gateway > List of Intents](https://docs.discord.com/developers/events/gateway):

| Intent | Bit | Why Botty needs it |
|---|---|---|
| `GUILDS` | `1 << 0` | Guild, role, channel and thread events, including `GUILD_CREATE`. Populates the guild/channel cache the dashboard lists. |
| `GUILD_MESSAGES` | `1 << 9` | `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `MESSAGE_DELETE`, `MESSAGE_DELETE_BULK` in guilds. |
| `MESSAGE_CONTENT` (privileged) | `1 << 15` | Without it, `content`, `embeds`, `attachments`, `components` and `poll` arrive empty. |
| `GUILD_MESSAGE_REACTIONS` | `1 << 10` | Only if the bot must *observe* reactions. Adding a reaction is a REST call and needs no intent. |

"If you do not specify a certain intent, you will not receive any of the Gateway events associated with that intent" ([Gateway](https://docs.discord.com/developers/events/gateway)).

What `MESSAGE_CONTENT` does ([Gateway > Message Content Intent](https://docs.discord.com/developers/events/gateway)): it is "a unique privileged intent that isn't directly associated with any Gateway events". Instead it controls whether the `content`, `embeds`, `attachments`, `components` and `poll` fields are populated. Without it, apps still receive content in:

- messages the app sends
- DMs with the app
- messages that mention the app
- the target message of a message context-menu command

Botty reads arbitrary links in enabled channels, so none of these exceptions covers it, and it needs the intent.

discord.js form ([GatewayIntentBits](https://discord.js.org/docs/packages/discord.js/14.18.0/GatewayIntentBits:Enum), [guide: Gateway Intents](https://discordjs.guide/legacy/popular-topics/intents)):

```ts
import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
```

If you request a privileged intent that isn't enabled in the portal, the gateway closes with **4014 Disallowed intent(s)**: "You may have tried to specify an intent that you have not enabled or are not approved for" ([Opcodes and Status Codes](https://docs.discord.com/developers/topics/opcodes-and-status-codes)). discord.js surfaces this as a "Used disallowed intents" error at login.

## 2. Privileged-intent approval threshold (changed June 2026)

Sources: [Change Log, June 10 2026 "Changes to Privileged Intent Access for Discord Apps"](https://docs.discord.com/developers/change-log), [Getting Started with Privileged Intent Review](https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review), [Gateway > Privileged Intents](https://docs.discord.com/developers/events/gateway).

- The threshold is now "the number of unique users who can see your app across all the servers it's in". It used to be 100 servers. "If your app is accessible to fewer than 10,000 users, these changes do not impact your app."
- Under the threshold: toggle the intent in the Developer Portal (Bot > Privileged Gateway Intents). There is "No need to apply for access."
- At the threshold: the portal notifies you, and "You will have 90 days from the date of the notification to apply." If you miss the window, access is removed. The app can keep joining servers while its application is under review.
- Once approved, you "must reapply each year through the Developer Portal".
- "We have separated App Verification and the Privileged Intent review process."

**Note:** the discord.js guide still says "not verified and in less than 100 guilds". That is out of date, so go by Discord's docs.

For Botty, a single-owner bot in a handful of servers, the practical question is whether those servers' combined membership stays under 10k users. Under it, just toggle the intent. Over it, an application is needed. The use case ("read links posted in channels an Admin enabled") is the kind of narrow, explainable purpose the review expects.

## 3. Channel permissions

Definitions from [Permissions](https://docs.discord.com/developers/topics/permissions):

| Permission | Bit | Need |
|---|---|---|
| `VIEW_CHANNEL` | `1 << 10` | Required: "view a channel, which includes reading messages in text channels". Without it, the other channel permissions are effectively ignored. |
| `READ_MESSAGE_HISTORY` | `1 << 16` | Required: Create Reaction "requires the `READ_MESSAGE_HISTORY` permission to be present on the current user" ([Message > Create Reaction](https://docs.discord.com/developers/resources/message)). |
| `ADD_REACTIONS` | `1 << 6` | Required when the bot is the first to use that emoji on the message, which is always the case for Botty's ✅/❌. ("does not apply to reacting with an existing reaction") |
| `SEND_MESSAGES` | `1 << 11` | Optional, only if a Module posts replies. Doesn't cover threads; that's `SEND_MESSAGES_IN_THREADS`. |

Minimum invite permission integer: `1024 + 65536 + 64 = 66624`. Add `2048` (`SendMessages`) to get `68672`. Channel overwrites are applied over guild permissions in this order: @everyone deny/allow, then role deny/allow, then member deny/allow. `ADMINISTRATOR` bypasses all of them. So a server can still deny the bot in a specific channel even when the invite granted the permission. Before enabling a channel, the dashboard should check `channel.permissionsFor(guild.members.me)` for the three required bits.

## 4. Where URLs appear in a message

From [Message resource](https://docs.discord.com/developers/resources/message). All of these fields need `MESSAGE_CONTENT`:

- `content`: the raw text. This is the main source of user-posted links.
- `embeds[]`: link unfurls have `type: "link"` (also `article`, `video`, `image`, `rich`, etc.). URL fields include `url` ("url of embed"), `image.url`/`proxy_url`, `thumbnail.url`, `video.url`, `provider.url`, `author.url`, and `footer.icon_url`. Most unfurl URLs just repeat what's already in `content`.
- `attachments[]`: `url` ("source url of file") and `proxy_url`. These are Discord CDN URLs for uploaded files, not user-posted links.
- `message_snapshots[]`: forwarded messages carry "a minimal subset of fields" of the original, including its content, embeds and attachments, frozen when forwarded. A link inside a forward is here, not in `content`.

**Unfurl timing:** `MESSAGE_UPDATE` carries "a message object with the same extra fields as MESSAGE_CREATE" ([Gateway Events](https://docs.discord.com/developers/events/gateway-events)). Discord's docs don't say when unfurled embeds are attached. In practice they often arrive in a later `MESSAGE_UPDATE` (this is not stated in the docs). Botty should therefore extract URLs from `content` on `messageCreate` rather than wait for embeds. Only listen to `messageUpdate` if editing a message should re-trigger the check.

**Partials:** these only matter if Botty listens for events on uncached messages, such as reactions added to old messages. In that case it needs `partials: [Partials.Message, Partials.Channel, Partials.Reaction]` and calls `.fetch()` on objects whose `.partial` is true ([guide: Partial Structures](https://discordjs.guide/legacy/popular-topics/partials)). Reacting to new messages doesn't need partials.

## 5. Enumerating guilds and channels for the dashboard

- With the `Guilds` intent, each guild arrives in `GUILD_CREATE` with extra fields including `channels` and `threads` ("All active threads in the guild that current user has permission to view") ([Gateway Events > Guild Create](https://docs.discord.com/developers/events/gateway-events)). discord.js caches them, so `client.guilds.cache` and `guild.channels.cache` are enough for the dashboard. No extra REST calls or `GuildMembers` intent are needed.
- REST alternative: `GET /guilds/{guild.id}/channels` "Does not include threads" ([Guild resource](https://docs.discord.com/developers/resources/guild)).
- **Channel obfuscation, effective November 16, 2026** ([Permissions > Channel Visibility](https://docs.discord.com/developers/topics/permissions); [Change Log, August 12 2026 "Channel Obfuscation for Users and Bots"](https://docs.discord.com/developers/change-log)):
  - Over the gateway, channels the bot can't view arrive with `name` set to `___hidden___`, sensitive fields nulled, a `CHANNEL_OBFUSCATED` flag, and one overwrite denying `VIEW_CHANNEL`.
  - `GET /guilds/{id}/channels` omits them entirely.
  - If the bot later gains access, it receives a `CHANNEL_UPDATE` with the full data.
  - You can test early with Identify `capabilities` `1 << 15` or the portal's "Private Channel Obfuscation" toggle.
  - What this means for the dashboard: filter out (or label) channels the bot can't view instead of showing `___hidden___`, and update the channel list on `channelUpdate`.

## Sources

- Discord: [Gateway (intents, privileged intents, Message Content)](https://docs.discord.com/developers/events/gateway)
- Discord: [Gateway Events (Guild Create, Message Update)](https://docs.discord.com/developers/events/gateway-events)
- Discord: [Getting Started with Privileged Intent Review](https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review)
- Discord: [Change Log (June 10 2026 intents; Aug 12 2026 channel obfuscation)](https://docs.discord.com/developers/change-log)
- Discord: [Permissions](https://docs.discord.com/developers/topics/permissions)
- Discord: [Message resource (Create Reaction, embeds, attachments, snapshots)](https://docs.discord.com/developers/resources/message)
- Discord: [Guild resource (Get Guild Channels)](https://docs.discord.com/developers/resources/guild)
- Discord: [Opcodes and Status Codes (4014)](https://docs.discord.com/developers/topics/opcodes-and-status-codes)
- discord.js: [GatewayIntentBits](https://discord.js.org/docs/packages/discord.js/14.18.0/GatewayIntentBits:Enum), [Guide: Gateway Intents](https://discordjs.guide/legacy/popular-topics/intents), [Guide: Partial Structures](https://discordjs.guide/legacy/popular-topics/partials)
