# Reminders on WhatsApp: draft plan and setup guide

Written 30 Oct 2026 for Jae. Prices and rules were checked on Meta's official pages that day (details and sources in `docs/reminders-research.md`). The email side is in `docs/reminders-email-plan.md`. Nothing here is built yet.

## Update, 31 Oct (replaces anything below that disagrees)

- **Paid guests only:** WhatsApp goes only to a guest with a paid order for that event (`ev_orders.status = 'paid'`) who agreed at checkout. Free events get email and push.
- **Messages, as on Luma:** day before and hour before, exactly 24 hours and 1 hour ahead, both paid utility templates, plus event changed and event cancelled when they happen. That's about $0.0134 (₦19) per paid guest. The ticket and the thank you go by email.
- **Templates:** `hoppaz_day_before`, `hoppaz_hour_before`, `hoppaz_event_changed`, `hoppaz_event_cancelled`. `hoppaz_ticket` is dropped.
- **Bot:** `STOP`, `START`, `TICKET` and `HELP` only. The "I'm coming" and "Can't make it" buttons and the free hour-before reply are dropped.
- **App:** a checkout switch and "WhatsApp reminders" labels on paid tickets. Use a new Hoppaz app and portfolio, not the side project's.

## 1. What "the Meta API" and "a bot" mean

| Thing | What it is | Automation | Cost |
|---|---|---|---|
| WhatsApp Business app | The free phone app small businesses use | Manual chats, plus a greeting message, an away message and quick replies. **It can't send automatic reminders to hundreds of guests.** | free |
| **WhatsApp Business Platform, Cloud API** | Meta's official API, which Meta hosts. Our code sends messages through it, and Meta sends incoming messages to our server (a "webhook"). | Anything we code | **per delivered message**, by category (below) |
| A "bot" | Not a separate Meta product. It's just our code answering incoming messages through the Cloud API. | Keyword replies, buttons, menus | the same per-message prices, nothing extra |
| Meta Business Agent (Meta's AI) | Meta's own AI that answers customers for you | AI chat | $2 per million tokens, about 4 to 5 cents a reply. **We don't need it.** |
| A BSP (Twilio, Gupshup, 360dialog and others) | A reseller that sits in front of the Cloud API | n/a | Meta's price plus their fee |

**Is Luma's WhatsApp a bot?** Partly. Luma's help pages describe:
- reminders (1 day and 1 hour before), host blasts and sign-in codes sent from one number, +1 (415) 212-6297;
- replies to keywords: STOP (all Luma messages off), START / REACTIVATE / SUBSCRIBE (back on), and X (leave one host);
- messages only to the phone linked to the Luma account.

So it's mainly an **automatic notification sender with keyword replies**, not a chatbot you hold a conversation with. Fairly called "a WhatsApp notifications bot". Luma doesn't say which provider it uses.

**What this means for pricing:** "bot" or not makes no difference to Meta. Meta charges per delivered message by type:

| Type | What it is | Nigeria, per message |
|---|---|---|
| Utility template | Reminders, tickets, changes to something the person booked. Can be sent any time. | $0.0067 (about ₦9.40) |
| Marketing template | Promotion of any kind | $0.0516 (about ₦72) |
| Authentication template | Sign-in codes | $0.0067 |
| Service message | A free-form reply inside 24 hours of the guest messaging us | **first 1,000 a month per number free**, then $0.0067 |
| Messages the guest sends us | n/a | free |

Our bot's replies are service messages, so they're free up to 1,000 a month. The only thing we really pay for is the day-before reminder template.

## 2. What ours does

The same kind as Luma's: a notifications sender with a small keyword bot. No AI, no BSP, and one number.

**What we send:**

| Message | How | Cost |
|---|---|---|
| Ticket (after "Get my ticket on WhatsApp") | free reply | $0 |
| Day before, with buttons "I'm coming", "Can't make it", "View ticket" | utility template | **$0.0067: the one paid message per guest** |
| About an hour before | free reply, only if the guest tapped a button in the last 24 hours | $0 |
| Event changed (time or place) | utility template, only when it happens | $0.0067 |
| Event cancelled | utility template, only when it happens | $0.0067 |
| Host Pops | not on WhatsApp at launch (email, push and in-app instead). Later, on host-paid credits. | n/a |

**What the bot understands:**

| They send | We do |
|---|---|
| `TICKET` or the code from the link | Link this number to their account, then reply with their next ticket link and QR |
| "I'm coming" | Mark them confirmed and reply "See you there". The hour-before reminder follows as a free reply. |
| "Can't make it" | "Free up your spot?" Yes / No. Yes cancels the registration, and the waitlist moves. |
| `STOP` | WhatsApp off for every host, then confirm |
| `START` | WhatsApp back on |
| `HELP` or anything else | "This number sends your Hoppaz tickets and reminders. Reply TICKET for your tickets, STOP to stop." |

**Opt-in, cheapest first:**
1. **"Get my ticket on WhatsApp"** on the ticket page and in the confirmation email.
   - The link opens WhatsApp with `TICKET <short code>` typed in, and the guest taps Send.
   - That proves the number is theirs, gives clear consent (NDPA and Meta both want this), and opens a free 24-hour window for the ticket reply.
2. **An unticked switch at checkout,** next to the phone field. We store when and how they agreed.

**Templates to submit** (category Utility, English, no promotion, each ends "Reply STOP to stop"):
- `hoppaz_day_before`: "{event} is tomorrow at {time}, {venue}." Buttons: I'm coming, Can't make it, View ticket.
- `hoppaz_ticket`: "You're going to {event}, {date} at {time}. Your ticket: {link}". Only for checkout opt-ins who never messaged us.
- `hoppaz_event_changed`: "{event} has changed: now {date} at {time}, {venue}."
- `hoppaz_event_cancelled`: "{event} on {date} is cancelled. {refund line}"

**Costs:** about $40 a month for Detty December (10,000 guests, 60% on WhatsApp). There's a monthly budget cap: when it's reached, WhatsApp stops and those guests get email and push.

## 3. Step by step

### Stage A: Meta accounts (Jae, about 1 hour of clicking, then waiting)

1. **Business portfolio.** Go to business.facebook.com. Use the Hoppaz portfolio if the Instagram or Facebook page already has one; otherwise create it. Fill in the legal business name, address, phone and website `https://hoppaz.fun`.
2. **Make hoppaz.fun match.** Meta compares the website with the documents.
   - The site needs the business name and a privacy policy (`/privacy` exists).
   - A contact email on the domain helps, but `hoppaz.fun` has no inbox today. Either add one (Hostinger email or Zoho free), or use the DNS method in step 3.
3. **Start business verification.** In Business settings, open Security Centre and choose Start verification.
   - Upload the CAC certificate, or a utility bill or bank statement showing the legal name and address.
   - Confirm the domain by adding the TXT record Meta gives you in Hostinger, or by email or phone.
   - Meta gives no fixed time. It's usually a few days and can take two weeks. **Start this first: everything else can run while it waits.**
4. **Developer app.** Go to developers.facebook.com, create an app, pick the use case "Connect with customers through WhatsApp", and link it to the portfolio.
   - Meta creates a WhatsApp Business Account and a **free test number.**
   - The test number sends only to a few recipients you add yourself, which is enough for me to build and test everything before the real number is ready.
5. **A real number.**
   - Buy a fresh SIM (MTN or Airtel) that has never been on WhatsApp. It only has to receive one SMS or call.
   - **Don't use the Hoppaz community number.** A number on the WhatsApp Business app can join the API only through a registered partner (Meta calls this "coexistence"). Otherwise it has to be deleted from WhatsApp first and loses its chats.
6. **Add the number** in WhatsApp Manager, under Phone numbers then Add.
   - Display name "Hoppaz", category Events or Entertainment, then confirm the code from the SMS.
   - The display name is reviewed, and it shows in chats once approved.
7. **Payment method.** In WhatsApp Manager, open Billing and add a card. Meta bills in USD, so use a card that works for dollar charges. Since 1 Oct, without a card even free-tier replies stop.
8. **Permanent token.**
   - In Business settings, open Users, then System users, and add an admin system user.
   - Give it the app and the WhatsApp account with full control, then generate a token with `business_management`, `whatsapp_business_messaging` and `whatsapp_business_management`.
   - **Put it straight into Vercel. Never in chat.**

### Stage B: the code (me, about 2 to 3 days, built on the test number)

1. **Environment names, empty in git:**
   - `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_NUMBER` (for the `wa.me` link).
   - A fake mode that never calls Meta, for dev and tests.
2. **`/api/whatsapp/hook`:**
   - `GET` answers Meta's setup check with the verify token.
   - `POST` receives incoming messages and delivery statuses, and every call is checked against the `X-Hub-Signature-256` signature using the app secret.
3. **Sender:** one function that calls Meta's `POST /{phone-number-id}/messages` for templates and replies. It plugs into the same `notify_queue` and `notify_sends` as email.
4. **Linking:** short one-time codes for "Get my ticket on WhatsApp". The number is stored on the person, with the time they agreed.
5. **Keyword bot:** the table in section 2.
6. **Cost log:** Meta's delivery status says whether each message was billable and in which category. That goes into `notify_sends.cost_usd`, and the monthly budget cap reads it.
7. **The templates** written in code, plus a small script Jae runs on his own machine. The script reads the keys from his environment, submits the templates and registers the number, so the keys never pass through chat.
8. **Tests** on the fake sender, then a live check on the test number with Jae's own phone.

### Stage C: switch it on (Jae and me, about 30 minutes)

1. In the app dashboard, open WhatsApp, then Configuration, and set the callback URL `https://hoppaz.fun/api/whatsapp/hook` and the verify token. Subscribe to the `messages` field.
2. Wait for the templates to be approved (up to 24 hours each).
3. Put the app in Live mode (it needs the privacy policy URL).
4. Turn on the `notify_whatsapp` flag for one small event first. Check delivery and cost in the send log.

### Stage D: grow the sending limit (November)

| Stage | Limit |
|---|---|
| Before verification | 250 different people a day outside the free reply windows |
| Verified | 2,000 a day |
| After steady good sending | Meta raises it to 10,000, then 100,000, as long as the number's quality stays good and we use at least half the limit over 7 days |

- Detty December's busiest nights need the 10,000 step, so send real reminders through November.
- Keep quality high: only opted-in guests, nothing promotional, STOP honoured at once.

## 4. Timeline

| When | What |
|---|---|
| Day 1 | Jae: Stage A steps 1 to 4 (verification submitted, test number ready). Me: start Stage B on the test number. |
| Days 2 to 3 | Jae: SIM, number, display name, card, token. Me: finish Stage B. |
| Day 3 to 4 | Templates submitted and approved. |
| When verification lands (days to about 2 weeks) | Stage C, one small event first, then everyone opted in. |
| November | Stage D: the limit grows ahead of Detty December. |

## 5. Not doing

- **Unofficial WhatsApp Web bots (whatsapp-web.js, Baileys).** They break WhatsApp's terms, and the number gets banned.
- **Meta's AI agent.** It costs money per reply; keywords are free.
- **A BSP.** It adds a fee. The only exception is if Meta won't take our card, in which case Gupshup ($0.001 a message) is the cheapest fallback.
- **Marketing templates and WhatsApp Pops at launch.**

Sources: Luma, SMS and WhatsApp messages (https://help.luma.com/p/sms-whatsapp-messages); Meta pricing (https://developers.facebook.com/docs/whatsapp/pricing); getting started (https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started); coexistence (https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/); messaging limits (https://developers.facebook.com/docs/whatsapp/messaging-limits).
