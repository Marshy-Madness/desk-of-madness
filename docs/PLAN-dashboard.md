# Desk pages, session tracker and Steam achievements (0.4.0)

Decided with the owner on 2026-10-11. The work ships as 0.4.0-beta.x on the testing channel.

## 1. Decisions

| Topic | Decision |
|---|---|
| Dashboard | The existing Desk. It becomes a set of **pages**, each holding its own Tomes. |
| Pages | Customizable: add, rename, delete and reorder. Starter pages are **Today** (session Tomes), **Game** (the current Tomes, with per-game layouts as before) and **Trophies** (achievement Tomes). |
| R1 / L1 | On the full-screen page, R1 goes to the next page and L1 to the previous one. The Quick Access tab has a row of page buttons instead. |
| Tome size | Per Tome: **tile** (a big number with a label, several to a row) or **card** (full width, with a title bar). Edit mode has a size button. |
| Day start | 4 AM. A session counts toward the day it started on. |
| Short runs | Sessions under 5 minutes don't count. |
| Non-Steam games | A setting, on by default. |
| History | Session Tomes use the plugin's own sessions. "Most played: all time" uses Steam's lifetime playtime. |
| Achievement data | On the Deck it comes from the Steam client (no key, works offline) and syncs to the server. The server can also refresh it from the Steam Web API with a single `STEAM_API_KEY` in the compose file. |
| Achievement % | Both numbers: the average over started games, and the average over every game with achievements. |
| Hidden achievements | Blurred until you press A. |
| Full achievements page | A stats header, a library grid, a per-game list and an unlock timeline. It opens from any achievement Tome, a radial slot, an optional combo, and an Achievements tab on the website. |
| Website and app | The Desk becomes the home screen, with the same pages. |

## 2. Tomes

Session Tomes (category "Play"):
- **Last session**: the game and its length in hours and minutes, plus when it was.
- **Games today**: how many different games you've played today.
- **Today**: today's playtime.
- **This week**: the week's playtime, with a 7-day bar chart.
- **Streak**: the current streak in days, plus the best streak.
- **Records**: longest session and average session length.
- **Most played**: the top 3 for the week, the month or all time (switched with A).
- **Activity**: a heatmap calendar covering the last 16 weeks (card).

Achievement Tomes (category "Trophies"):
- **Achievement %**: started games and all games.
- **Perfect games**: how many, with "N close" underneath.
- **Game progress**: the current game's %, a bar and its next locked achievements.
- **Recent unlocks**: the last 5 across all games.
- **Almost perfect**: the games with the fewest achievements left.
- **Rarest**: your rarest unlock by global %.
- **Unlock totals**: total unlocked, plus how many this week.

## 3. Data

**Sessions.** `py_modules/playstats.py` is a shared stdlib module used by both the plugin and the server, the same way merge.py is. It takes every game's sessions and returns all the numbers above in one call. The client sends its timezone offset, so "today" means the same thing on the Deck and on the website.
- Plugin: the `play_stats` backend call.
- Server: `GET /api/stats/play`.

**Achievements.**
- The Deck front-end reads `window.appAchievementProgressCache` for every owned app. That gives unlocked, total, percentage and all_unlocked for each game, and querying a game makes Steam fill in its entry. It calls `SteamClient.Apps.GetMyAchievementsForApp` for the full list of games played recently or opened.
- It saves the result through the backend to `achievements.json`, and the sync uploads it with `PUT /api/achievements`.
- The server keeps one file per user and fills it in from the Web API (GetOwnedGames, GetPlayerAchievements, GetSchemaForGame and GetGlobalAchievementPercentagesForApp) when `STEAM_API_KEY` is set and the user has a Steam ID. The newest data for each game wins.

## 4. Phases

- **A (beta.1)**: pages, R1/L1, tile/card, playstats and the session Tomes on the Deck.
- **B (beta.2)**: achievements on the Deck, with the Tomes, the full page, the radial slot and the combo.
- **C (beta.3)**: the server APIs and Web API key, and the website Desk as the home screen, with pages, Tomes and the Achievements tab.
