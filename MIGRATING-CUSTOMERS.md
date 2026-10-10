# Moving existing customers onto the new Dome Box

**Short answer:** your customers don't move anywhere. Each company keeps the
spreadsheet it already has. The new software reads that same spreadsheet, and
the upgrade only **adds** to it. Their tasks, history, team, appraisals and
passwords stay exactly where they are.

For your customers there is **nothing to do**. Same website, same email, same
password.

---

## What happens to a customer's data

| | |
|---|---|
| **Their spreadsheet** | Stays where it is, in your Google Drive. Not copied, not exported, not re-imported. |
| **Tasks** | Every task, every status, every due date, every history note — unchanged, byte for byte. |
| **People** | Every user stays, with the same role and manager. |
| **Passwords** | The same password keeps working. On first sign-in it is quietly upgraded to a secure hash — they will not notice. |
| **Appraisals and KRAs** | Unchanged and still shown in Reports. |
| **Job categories** | Unchanged. |
| **Repeating jobs** | Still repeat as before. No stop date is forced on them. |
| **Their plan** | Honoured exactly as sold. "Standard" keeps 20 seats; "Pro" keeps its seats. Both get every new feature. Expiry date unchanged. |
| **Scores** | Worked out from their existing task history, so the score and leaderboard mean something on day one. |

### What the upgrade adds

- New column **headings** written into empty columns after the old ones
  (repeats, projects, delegation). The old 15 task columns and 9 user columns
  are not touched.
- Tabs that didn't exist before — such as `Cookie_Points` — next to the old tabs.
- Sign-in access for anyone who was added to a sheet by hand and could not have
  logged in otherwise. They keep the password already in their row.

Nothing is renamed, reordered, rewritten or deleted.

---

## The one case that is held back, on purpose

The new software knows each column **by its position**. If someone at a
customer once added a column of their own straight after the old ones —
"Site Notes", say — the new software would have treated that column as one of
its own, and the first task update would have **written over their notes**.

So before upgrading anyone, every sheet's columns are checked one by one. A
sheet that doesn't match is **left exactly as it is**, and:

- the customer sees *"Your workspace needs a quick check by our team before it
  can open. Nothing has been changed or lost"*;
- you get an email naming the exact column;
- `previewMigration` lists it under **NEEDS A LOOK** and tells you where to
  move the column (for Tasks: column **AD** or later — past the last column
  Dome Box uses).

Move the column, run `previewMigration` again, and they're through. A workspace
that waits an hour for you is a bad hour. One that silently overwrote a
customer's own column is a lost customer.

---

## Your steps

This is step 11 of [`DEPLOY-EASY.md`](DEPLOY-EASY.md), in more detail.

1. **Back up.** Add `domebox/backup.gs` to the Apps Script project, run
   `backupAllTenants`, then `verifyLatestBackup`. Every customer's sheet is
   copied to a backup folder in your Drive. Don't skip this.

2. **Point the new code at your live customers.** Script Properties →
   `MASTER_DB_ID` = your **live** registry spreadsheet ID. Set the same ID as
   `SHEET_ID` at the top of `reminders`. Run `ensureRegistry`.

3. **Preview.** Run `previewMigration`. It changes nothing. Read the log:

   ```
   === MIGRATION PREVIEW — nothing is changed ===

   3 customers in the registry.

   --- WILL BE UPGRADED (2) ---
     Ghosh Fabricators — 3 people, 6 tasks; will add Tasks +14 columns,
       Users +4 columns, new Cookie_Points tab, new Goals tab, …; 1 person
       would be locked out — will be fixed
     Another Customer — 1 person, 1 task; will add …

   --- NEEDS A LOOK (1) — LEFT EXACTLY AS THEY ARE ---
     Bose Steel — Tasks column P is "Site Notes" where Dome Box needs "Spawned By"
   ```

4. **Fix anything under NEEDS A LOOK.** Open that customer's sheet, move the
   named column to where the log says, and run `previewMigration` again. Repeat
   until there is no NEEDS A LOOK section.

5. **Migrate.** Run `migrateAllTenants`. Same report, now saying **UPGRADED**.

6. **Switch the website over** — the domain step in `DEPLOY-EASY.md`.

7. **Sign in as yourself** with your existing password, and open one customer
   workspace you know well. Check its tasks look right.

8. **Send customers the email below.**

9. **Keep your old Apps Script deployed for a week**, unused. If anything goes
   wrong, put its URL back into Netlify's `API_URL` and everyone is on the old
   system again — with their data still intact, because the upgrade only added
   to it.

10. **Then run step 12** — lock down old customer files. The old system shared
    every customer spreadsheet as *anyone with the link can edit*. The upgrade
    deliberately leaves that alone so it can't surprise anyone mid-switch; step
    12 closes it.

If you forget step 5 for someone — a customer added after the run, say — their
first sign-in does the same upgrade, with the same column check.

11. **Later, once a month: move year-old work aside.** After a week on the new
    system, back up again, run `previewTaskArchive`, then `archiveOldTasks`.
    Tasks closed over a year ago move to a new *Tasks_Archive* tab in the same
    customer file — copied and read back before anything is removed, and no
    report, score or appraisal changes. `installTaskArchiveSchedule` repeats it
    monthly. See SETUP.md §2.6.

---

## Email to send your customers

Send this from `info@biscsindia.com` once the switch is done.

> **Subject: Dome Box has been upgraded — nothing for you to do**
>
> Hello,
>
> We have upgraded Dome Box. You don't need to do anything: go to
> www.domebox.in and sign in with the same email and password as before. All
> your tasks, history, team and appraisals are exactly where you left them.
>
> **What's new for your team**
>
> - **A fairer score.** Ten jobs delivered with seven on time now scores well
>   above one easy job done. Approved leave and slow manager reviews no longer
>   count against anyone.
> - **Priority list** — one ranked list of what to do next, with the reason on
>   every row.
> - **Projects** — multi-stage work where each stage releases the next
>   automatically.
> - **Repeating jobs that stop by themselves** — on a date, or after a number
>   of times.
> - **Leaderboard** — top of the month to bottom. Your admin chooses who sees it.
> - **Cookie points** — recognise extraordinary work the score can't see.
> - **GST invoices** — emailed automatically for every payment.
> - **Help inside the app** — press **?** anywhere.
>
> **Your plan**
>
> Your current plan carries on exactly as you bought it, at the same price, and
> now includes every new feature.
>
> Questions? Just reply to this email.
>
> — Team Dome Box, BISCS India

---

## How we know this works

`tests/migration-test.js` builds customer workspaces **exactly as the old
system wrote them** — old column layout, plaintext passwords, old plan names,
history, appraisals, a sheet shared publicly, and one customer with their own
added column — then runs the new code against them and checks, among 68 things:

- every old task row is byte-for-byte unchanged after use
- every user signs in with their old password, including one added by hand
- "Standard" keeps 20 seats; "Pro" keeps its plan
- the customer with their own column is refused, told nothing was lost, and
  their notes survive untouched — before and after the column is moved
- one company never sees another's work
- a customer missed by the migration still gets upgraded on first sign-in

Building that test is what found the two problems fixed before this shipped:
every existing user would have been shown *"This account has been
deactivated"*, and old sheets were never actually being upgraded at all.
