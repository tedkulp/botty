# Botty

A Discord bot whose behaviour is built from Modules, configured by Admins through a web dashboard.

## Language

**Module**:
A self-contained piece of bot functionality, shipped with the bot, that can be switched on or off globally and per channel.
_Avoid_: function, plugin, feature

**Admin**:
A person allowed to sign in to the dashboard and configure every server the bot is in.
_Avoid_: user, moderator, operator

**Enabled (in a channel)**:
A Module is enabled in a channel when it is switched on globally and switched on for that channel. Each Module decides whether new channels start switched on or off. A thread follows its parent channel.
_Avoid_: active, installed

**Module status**:
A Module's self-reported health (ok, degraded, or error, with a message), shown to Admins alongside the last error it hit.
_Avoid_: state, health check

**Global config**:
A Module's settings that apply everywhere the bot is, such as which Karakeep instance to use.
_Avoid_: defaults, server config

**Channel config**:
A Module's settings for one channel, separate from its Global config, not an override of it. Threads use their parent channel's Channel config.
_Avoid_: override, channel settings

**Activity entry**:
One recorded thing a Module or an Admin did, such as links saved from a message or a Module switched off in a channel, shown to Admins in the dashboard. A Module's Activity is its recent Activity entries.
_Avoid_: log, audit, event
