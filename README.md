# SillyTweaks

Small additions to [SillyTavern](https://github.com/SillyTavern/SillyTavern):

- **Scenario Clock** keeps the date and time *inside your story* and tells the AI on every reply, so the time stays right over long chats and after summaries.
- **Realism Mode** asks the AI for one line of dialogue and one action per reply, so the chat flows like a real conversation. Switch it on and off from the ☰ menu, next to Regenerate and Continue.

## Install

Needs SillyTavern 1.19 or newer.

1. In SillyTavern, open **Extensions** (the cubes icon) → **Install extension**.
2. Paste `https://github.com/kbm8fb8gsf-sudo/SillyTweaks` and click **Install just for me** (or **Install**).
3. SillyTavern warns that it's a third-party extension. Click **Yes, install it**.

**Extensions** gets a **SillyTweaks** section, and the browser console shows `[SillyTweaks] Loaded.`

To update later, use the update button next to SillyTweaks in **Extensions → Manage extensions**.

**Already installed Scenario Clock?** SillyTweaks is its new name. Don't install it again: click the update button next to Scenario Clock instead. Your settings and your chats' clocks carry over. If you do end up with both, SillyTweaks shows a warning; delete the old one.

Or install it by hand:

```sh
cd SillyTavern/data/default-user/extensions   # or your user's folder
git clone https://github.com/kbm8fb8gsf-sudo/SillyTweaks
```

## Scenario Clock

Models are bad at keeping track of story time over a long chat, and once older messages are summarised the time is usually lost completely. Scenario Clock works the time out from the chat itself and adds it to every prompt:

> [Story clock: it is 9:42 PM on Thursday, 14 March 2024 (night), day 3 of the story. This is the correct current time and date; it overrides any other time or date in the chat history or its summaries.]

Each chat has its own clock. The AI moves it with short tags such as `[TIME: +5m]` or `[TIME: +3h]`. The extension does the calendar maths (weekdays, month ends, leap years), which models get wrong.

**New chats get a clock automatically.** By default it starts at the real date and time. You can choose a fixed start in the settings, or set the time in the panel. A character can set its own scene: put a tag like `[TIME: 1889-10-04 18:00]` in its greeting.

**Existing chats** start without a clock. Open **Extensions → SillyTweaks**, pick the story's current date and time, and click **Start clock**.

### How time passes

Choose under **How time passes**:

| Setting | What happens between time skips |
|---|---|
| **The AI's estimate, in every reply** (default) | The AI ends every reply with a tag saying how much time it took: `[TIME: +1m]` for a few quick lines, `[TIME: +15m]` for a longer scene. It judges from what actually happens, so a long reply can move the clock more than a short one. Your own messages add no time; the AI's next tag covers them. A reply that forgets its tag is timed from its length instead. |
| **Each message's length** | Every message adds about the time its words take to play out (around 120 words a minute), so longer messages move the clock more. No tags needed. |
| **A fixed amount per message** | Every message adds the same number of minutes. |

With the last two, the AI can still skip time with a tag when the story jumps (you can turn that off). With any of them, you can add tags to your own messages too: *"[TIME: +1h] I wait outside the café."*

Changing this applies to new messages only. Times already shown never move.

You can also move the clock by hand: with the panel's buttons and box, the **Clock** entry in the wand (✨) menu, or `/clock`.

Tags are hidden in the chat by default, but stay in the message text. Edit a message and you'll see them, and can change them. Each message's header shows the story time just after it (🕒 *Thu 14 Mar, 9:42 PM*); hover over it to see how much time that message took.

Because the clock is worked out from the messages every time, it follows the chat. If you delete messages, the clock goes back. If you edit a tag or swipe to another reply, the clock changes with it. Branches keep the time they branched at. A change you make by hand belongs to the latest message. If you delete that message or swipe to a different reply, the change goes with it. New swipes keep it.

### Time changes

Tags, the panel's box and `/clock` all accept the same things, and you can combine them:

| Write | Meaning |
|---|---|
| `+20m` `+3h` `+2h30m` `+1.5h` `+2d` `+1w` `+1mo` `+1y` `-15m` | Move by that much |
| `3 hours`, `an hour later`, `half an hour`, `a few days later`, `next week` | The same, in words |
| `07:30` `7:30pm` `7pm` `noon` `midnight` | The next time the clock shows that time (07:30 at night means 7:30 tomorrow) |
| `morning` `afternoon` `evening` `tonight` `dawn` `dusk` | The next 08:00, 15:00, 18:00, 21:00, 06:00 or 19:00 |
| `tomorrow`, `tomorrow 9am`, `+2d 08:00` | Days ahead, at that time. After midnight, "tomorrow 9am" means the coming 9 AM |
| `friday`, `next monday 09:00` | The next such day |
| `2024-03-15`, `2024-03-15 18:00` | An exact date (and time) |

Tags whose contents can't be read are left visible in the chat, so you can spot them.

### With Summarize

The clock is already in the prompt when a summary is written (without the tag instructions, so summaries don't get tags). To have summaries record times too, add something like this to the Summarize prompt: *"The story's current date and time is {{scenario_datetime}}. Mention when events happened."*

## Realism Mode

While Realism Mode is on, every reply gets this note:

> (OOC: Realism mode, one line of dialogue and one action only, so it flows like a real conversation.)

Switch it from the ☰ menu at the bottom left, where Regenerate and Continue are. The menu item shows whether it's on, and the ☰ button gets a small dot while it is. You can also use the SillyTweaks panel or `/realism`. You can edit the note, and its depth and role, in the panel.

The note goes into normal replies, swipes, regenerations, continues and impersonations, but never into quiet background prompts such as summaries.

## Slash commands

- `/clock`: returns the story date and time. `format=time|date|weekday|timeofday|day|iso` returns one part.
- `/clock +2h` (or any change above): moves the clock, then returns the new time. Add `quiet=true` to skip the notice.
- `/clock-start 2024-03-14 21:42`: starts or restarts this chat's clock, as of the latest message. `/clock-start now` uses the real time.
- `/clock-undo`: takes back the last change you made by hand after the latest message.
- `/clock-stop`: removes the clock from this chat.
- `/realism on`, `/realism off`, `/realism` (switches it), `/realism status`: return `on` or `off`.

## Macros

These work anywhere SillyTavern reads macros: character cards, Author's Note, World Info, Quick Replies and the Summarize prompt. They're empty in chats without a clock.

`{{scenario_time}}` `{{scenario_date}}` `{{scenario_weekday}}` `{{scenario_timeofday}}` `{{scenario_day}}` `{{scenario_datetime}}` `{{scenario_iso}}`

## Prompt caching

With the default settings, SillyTweaks doesn't get in the way of prompt caching (Claude, OpenAI, DeepSeek and so on). The clock and the Realism Mode note go at depth 0, right after the latest message, so everything before them stays the same from one reply to the next. Swipes send exactly the same prompt as the reply they replace.

What would hurt caching:

- **Moving the clock up the prompt.** Its text changes with every reply, so before or after the main prompt the cache misses on every reply. The panel warns you if you change this.
- **Putting `{{scenario_*}}` macros early in the prompt** (character card, system prompt). They're fine in the Summarize prompt, which is a separate request.
- **Claude with `claude.cachingAtDepth: 0`** in SillyTavern's `config.yaml`: each reply re-caches about the last exchange. Use 2.

SillyTavern can also change the start of the prompt by itself, with or without SillyTweaks: when lorebook (World Info) entries switch in and out as the conversation moves on, and when example dialogues get pushed out of a small context as the chat grows.

## Settings

All in **Extensions → SillyTweaks**:

- **Scenario Clock**: on or off; how time passes; whether the AI may skip time; starting clocks automatically, at the real time or one you choose.
- **Display**: hide time tags, show them as small 🕒 badges, or leave them as written; the time on each message; 24-hour clock; date style.
- **Clock prompt**: where it goes (in the chat at a depth, or before or after the main prompt) and as which role; the clock text and the tag instructions. They use the macros above.
- **Realism Mode**: on or off, the note, and its depth and role.

## Limits

- Gregorian calendar only, years 1 to 9999. There's no support for fantasy calendars.
- No time zones. The clock is a wall-clock reading, so daylight saving never moves it.
- The AI has to cooperate. Most models follow the tag instructions well, especially at depth 0. If one keeps forgetting, switch **How time passes** to message length, or move the clock yourself.

## Checking it in SillyTavern

The automated tests cover the time maths, the tag parser, the timeline, the panel, Realism Mode and the SillyTavern wiring against a stand-in. SillyTweaks 0.2 was also tested end to end in a real SillyTavern 1.19.1 against a stand-in AI: installing and updating through the Extensions menu, the prompts sent (including prompt caching), hidden tags while streaming, swipes, quiet prompts, Realism Mode, slash commands, reloads, and double installs. A quick check of your own:

- [ ] Start a new chat. The panel shows a clock, and the wand menu shows **Clock: …**.
- [ ] Send a message, then open the prompt inspector for the reply. The last system message holds the story clock and asks for a time tag at the end of the reply.
- [ ] The reply ends with a tag like `[TIME: +2m]`. It's hidden in the chat, and the message header shows the new time.
- [ ] Ask the character to skip to the next morning. The header and the panel show the morning.
- [ ] Swipe that reply. The prompt for the new swipe has the time from *before* the old reply.
- [ ] Delete the reply. The clock goes back.
- [ ] Open ☰ and click **Realism Mode**. It shows as on, and the ☰ button has a dot. The next prompt ends with the Realism Mode note, and the reply is one line of dialogue and one action.
- [ ] Type `/realism off`, `/clock +1h` and `/clock format=time`.

## Development

Plain ES modules, type-checked with JSDoc. `index.js` is the only file that talks to SillyTavern. The clock lives in `src/clock/`, Realism Mode in `src/realism.js`, and the settings and panel in `src/`.

```sh
npm install
npm run check   # lint, type checks and tests
```

`e2e/` drives a real SillyTavern in headless Chromium (Playwright) against a stand-in AI that records every prompt:

```sh
node e2e/fake-ai.mjs &                                          # the stand-in AI on port 5001
node SillyTavern/server.js --browserLaunchEnabled false &       # SillyTavern on port 8000, with Seraphina
node e2e/setup.cjs                                              # connects to the stand-in, installs SillyTweaks from GitHub
npm run e2e                                                     # 45 checks
```
