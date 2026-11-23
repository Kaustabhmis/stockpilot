# Running the partner programme and referrals

For you, the owner of Domebox (BISCS India). Customers never see this.

## How it works

| | Referral (any customer) | Partner (consultant, CA firm, advisor) |
|---|---|---|
| Link | `www.domebox.in/?ref=C…` — under **Plans → Invite a business** | `www.domebox.in/?ref=P…` — emailed to them |
| Reward | **Up to 30 days free** on their plan when the company they invited first pays (never more than the value of that payment, in days of their own plan) | **20% of every payment** (before GST) from each company they brought in, for as long as it pays |
| Paid how | Automatically, added to their plan | By you, by bank or UPI |

A visitor who arrives on a link is remembered for 30 days in their browser, so
they can sign up later and still count.

Rewards are given only after a payment has been verified with Razorpay. Nobody
can earn days or commission without a real payment.

All of it is in the **Domebox Master** spreadsheet, in four tabs:

| Tab | What it holds |
|---|---|
| **RefCodes** | Every company's invite code |
| **Referrals** | Who signed up with which code, and what it earned |
| **Partners** | Your partners: you type them in here |
| **PartnerEarnings** | One row per payment that earned a partner commission |

## Adding a partner (2 minutes)

1. Open the **Domebox Master** spreadsheet → **Partners** tab. If the tab is not
   there yet, run `activatePartners` once in Apps Script and it is made.
2. On a new row, fill in **Name** and **Email**. Phone, Firm, Commission % and
   Payout details (their UPI ID or bank account) are optional. Leave **Status**
   blank. A blank Commission % means 20%.
3. In Apps Script, choose **activatePartners** and press **Run**.

They get an email with their share link and their private dashboard link, and
Status changes to **Active**.

- **They lost the link:** set Status to `Resend` and run `activatePartners`
  again. A new link is sent and the old one stops working.
- **Pause a partner:** set Status to `Paused`. Their link stops recording new
  sign-ups and they earn no commission while paused. Companies they already
  brought in stay theirs, and earn again if you set them back to `Active`.

## Paying partners (once a month)

1. In Apps Script, run **partnerPayoutReport**. The log shows each partner's
   total earned and what is due now.
2. Pay them by bank transfer or UPI.
3. In the **PartnerEarnings** tab, write the date and reference (e.g.
   `2026-12-05 UPI 412345`) in the **Paid out** column of each row you paid.
   Their dashboard then shows it as paid.

## Changing the numbers

In Apps Script → Project Settings → Script Properties:

| Property | What it changes | Default |
|---|---|---|
| `REFERRAL_REWARD_DAYS` | The most days a customer gets for each company they invite that pays | 30 |
| `PARTNER_COMMISSION_PCT` | Commission for new partners (a partner's own row overrides it) | 20 |

If you change `REFERRAL_REWARD_DAYS`, the button in the app still says "up to 30
days free". Ask for it to be changed to match.

## Telling partners about it

The website has a page for this: **www.domebox.in/partners**. Send it to CA
firms, ISO and IATF consultants, and business advisors you know.
