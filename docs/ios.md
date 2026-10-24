# spår on an iPhone or iPad

spår runs in Safari on an iPhone or iPad like any website. To have **reminders ring**, it has to be
added to the Home Screen and opened from there. iOS gives Web Push only to web apps on the Home
Screen, from iOS and iPadOS 16.4 onwards
([WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).
A Safari tab never receives notifications.

Reminders also need a server that sends them: the [spår server](self-hosting.md#one-container), or
[your own Supabase project](self-hosting.md#bring-your-own-supabase), reached over HTTPS. The public
demo has no server, so its reminders wait in the Reminders list and never ring.

*Screenshots of each step are still to be added.*

## Add it to the Home Screen

**Do this before you write anything**, if you use spår on this device only (without a server): iOS
keeps a Home Screen web app's website data apart from Safari's, so notes written in a Safari tab do
not appear in the Home Screen app. If they already exist, open the About page in the tab, use
**Download everything**, and keep the zip.

### iOS and iPadOS 26 or later

1. Open your spår address in **Safari**.
2. Tap the **Share** button. With the compact tab bar it is behind the **⋯** button; with the Top or
   Bottom tab layout it is in the toolbar.
3. Scroll down the list of actions and tap **Add to Home Screen**. If it is not there, tap
   **Edit Actions** at the bottom of the list and add it.
4. Leave **Open as Web App** switched on (it is on by default), and tap **Add**.

Apple's own guide: [Open a website as a web app on iPhone](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).
Since iOS 26 every site added this way opens as a web app unless that switch is turned off
([WebKit: Safari 26](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)).

### iOS and iPadOS 16.4 to 18

1. Open your spår address in **Safari**.
2. Tap **Share** (the square with an arrow, in the toolbar).
3. Tap **Add to Home Screen**, check the name, and tap **Add**.

There is no switch on these versions; spår's manifest asks to be opened as an app, so the icon opens
it full screen, without Safari's address bar.

### From another browser

Since iOS 16.4 other browsers can add a site to the Home Screen through their own share menu. In
Chrome, tap **Share** at the right of the address bar, then **Add to Home Screen**
([Google's help](https://support.google.com/chrome/answer/9658361?hl=en&co=GENIE.Platform%3DiOS)).
Whether Edge and Firefox on iOS offer the same is not confirmed here; Safari is the path Apple
documents.

## Signing in from the Home Screen app

With your own Supabase project, spår signs in by email. The email holds a link and a six-digit
code. **On an iPhone or iPad, type the code** into the Home Screen app: Mail opens the link in
Safari, and iOS keeps the Home Screen app's storage apart from Safari's, so the link signs in
Safari and leaves the app where it was. After **Send link**, the app's "Check your email" screen has
a field, **Type the code instead**; type the code there and tap **Sign in**. The link still works
everywhere else, and in a Safari tab.

The code is only in the email if the project's email template carries it. Supabase's own template
has the link alone: in the dashboard, under **Authentication → Emails → Templates → Magic Link**, add
`{{ .Token }}` beside `{{ .ConfirmationURL }}` (`supabase/templates/magic_link.html` in this
repository is one to paste; the local stack sends it already). A code works once and lasts an hour
(`otp_expiry`), as the link does.

A spår server signs in with a password instead, and none of this applies to it.

*Not yet confirmed on a real iPhone (audit 2026-10-10, UX-11).*

## Turn on reminders

1. Open spår **from the new Home Screen icon**, not from Safari, and sign in.
2. Open a note and set a reminder. The first time, iOS asks whether spår may send notifications.
   Tap **Allow**.

spår asks only at that moment, because iOS lets a web app ask for notifications only in answer to
something you just tapped. If you tap **Don't Allow**, the note says the reminder will not ring on
this device; the reminder itself is kept and still rings on your other devices.

Afterwards the permission lives with every other app's: **Settings → Notifications → spår**. Sounds,
banners, the lock screen and Focus modes apply to it as they do to any app. Each device (and each
browser on a computer) is switched on separately, from the reminder panel of any note.

### When a reminder does not arrive

- **Opened from Safari rather than the icon?** Only the Home Screen app can ring.
- **Notifications allowed?** Check Settings → Notifications → spår.
- **Focus on?** A Focus mode may be holding it back, as it would any app's.
- **A new server address?** If the app is now served from a different address, add it to the Home
  Screen again from that address and allow notifications again.
- **The server.** Reminders are sent by your server, which looks for due ones every minute; it has to
  be running and reachable over HTTPS for a reminder to ring.

## In the European Union

In February 2024 the iOS 17.4 betas stopped Home Screen web apps in the EU: they opened as ordinary
Safari bookmarks, without running as apps and without notifications
([9to5Mac, 15 February 2024](https://9to5mac.com/2024/02/15/ios-17-4-web-apps-european-union/)).
**Apple reversed this on 1 March 2024**, before iOS 17.4 shipped, and said it would "continue to
offer the existing Home Screen web apps capability in the EU", built on WebKit as before
([Apple's statement, archived](https://web.archive.org/web/20240305/https://developer.apple.com/support/dma-and-apps-in-the-eu/);
[9to5Mac, 1 March 2024](https://9to5mac.com/2024/03/01/apple-home-screen-web-apps-ios-17-eu/)).

What that means for spår today:

- **Confirmed:** Apple's statement that the existing capability, which includes Web Push and app
  badges, stays in the EU. WebKit's later announcements for iOS 18.4 and iOS 26 describe web app and
  push features with no regional exception
  ([Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/),
  [Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)). Developers who
  had built on it reported that everything kept working
  ([Progressier, 2 March 2024](https://intercom.help/progressier/en/articles/8955905-updates-about-the-impact-of-ios-17-4-for-pwas-in-the-eu)).
- **Not confirmed independently:** no dated, first-hand test of a web push arriving on an EU iPhone
  after 17.4 was found for this page. Apple's statement no longer appears on its current DMA page,
  which no longer mentions Home Screen web apps at all. Some articles still say push does not work
  in the EU (for example
  [MagicBell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide));
  they describe the withdrawn beta behaviour and contradict Apple's statement.
- **Other browser engines in the EU:** since iOS 18.2 an EU browser built on its own engine may add
  Home Screen web apps that run on that engine
  ([MacRumors](https://www.macrumors.com/2024/10/24/ios-18-2-eu-third-party-browser-web-apps/)).
  Whether Web Push works in those is not documented, and as of mid-2025 no such browser had shipped
  ([AppleInsider](https://appleinsider.com/articles/25/07/14/apple-still-effectively-blocks-rival-browser-engines-on-ios-despite-eu-order)).
  Add spår from Safari to be on the path Apple describes.

If you use spår in the EU and reminders ring (or do not), an issue saying which iOS version you run
would settle this for the next reader.
