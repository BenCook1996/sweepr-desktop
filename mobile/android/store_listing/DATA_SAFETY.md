# Sweepr — Google Play Console Data Safety Form & Policy Compliance (`#4`, `#36`)

## 1. Permissions & Policy Compliance Summary
Sweepr strictly adheres to Google Play's Photo and Video Permissions policy and Scoped Storage rules:
- **Included Permissions:**
  - `android.permission.READ_MEDIA_IMAGES` & `android.permission.READ_MEDIA_VIDEO` (Core functionality: scanning and cleaning duplicate/similar/blurry photos, screenshots, and large videos on Android 13+)
  - `android.permission.READ_MEDIA_VISUAL_USER_SELECTED` (Android 14+ partial photo picker access support)
  - `android.permission.READ_EXTERNAL_STORAGE` (`maxSdkVersion="32"`) & `android.permission.WRITE_EXTERNAL_STORAGE` (`maxSdkVersion="28"`)
  - `android.permission.READ_CONTACTS` & `android.permission.WRITE_CONTACTS` (Core functionality: finding and merging duplicate contacts on-device)
  - `android.permission.READ_CALENDAR` & `android.permission.WRITE_CALENDAR` (Core functionality: scanning and cleaning past calendar events older than 1 year 100% locally on-device)
  - `android.permission.POST_NOTIFICATIONS` (Optional weekly/monthly cleanup reminders and battery care unplug/overheat alerts)
  - `android.permission.INTERNET` (Google Play Billing / RevenueCat entitlement verification and optional Cross-Platform Sweepr Account email OTP sign-in)
- **Excluded / Prohibited Permissions (NEVER used):**
  - ❌ `MANAGE_EXTERNAL_STORAGE`
  - ❌ `QUERY_ALL_PACKAGES`
  - ❌ `PACKAGE_USAGE_STATS`

---

## 2. Google Play Data Safety Questionnaire Answers

### Overview Questions
| Question | Answer | Rationale |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | Only for subscription purchase history (RevenueCat / Google Play Billing) and optional email address if the user chooses to sign in with a Cross-Platform Sweepr Account. Photos, videos, and contacts are processed **100% on-device** and never leave the phone. |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | All HTTPS (`TLS 1.2+`) connections to `https://sweeprcleaner.com` and RevenueCat APIs. |
| Do you provide a way for users to request that their data is deleted? | **Yes** | In-app one-tap deletion via **Settings → My Account → Delete Account & Data** (`DELETE /v1/account`) and via `https://sweeprcleaner.com/privacy` or `mailto:support@sweeprcleaner.com`. |

---

### Data Types Breakdown

#### A. Photos and Videos (`MediaStore`)
- **Collected:** **No** (Processed ephemerally 100% on-device; never transmitted off the device).
- **Shared with third parties:** **No**.
- **Deletions:** Handled via Android's official `MediaStore.createTrashRequest` (30-day System Trash with user confirmation dialog).

#### B. Contacts (`ContactsContract`) & Calendar (`CalendarContract`)
- **Collected:** **No** (Contacts are scanned and linked/merged 100% locally via `ContactsContract.AggregationExceptions`, and past calendar events older than 1 year are scanned and deleted 100% locally via `CalendarContract.Events`; neither ever leaves the device).
- **Shared with third parties:** **No**.

#### C. Personal Info → Email Address (Optional)
- **Collected:** **Yes (Optional — only if user taps "Sign in with Sweepr Account")**
- **Shared:** **No**
- **Processed ephemerally:** **No** (Stored to link the user's cross-platform subscription across desktop/mobile devices).
- **Required or Optional:** **Optional** (Users can use Sweepr and subscribe via Google Play without ever entering an email address).
- **Purpose:** Account management, App functionality (syncing cross-platform entitlement).

#### D. Financial Info → Purchase History
- **Collected:** **Yes**
- **Shared:** **No** (Processed via Google Play Billing and RevenueCat as a service provider).
- **Required or Optional:** **Required for Premium subscription**.
- **Purpose:** App functionality (verifying active `premium` entitlement, restoring purchases).

#### E. Device or Other IDs
- **Collected:** **Yes** (Anonymous installation UUID / RevenueCat anonymous `appUserID`).
- **Shared:** **No**.
- **Purpose:** App functionality, Fraud prevention (enforcing device seat limit on linked cross-platform accounts and restoring subscriptions).

#### F. Crash Logs & Diagnostics (`LogFiles.kt`)
- **Collected automatically:** **No** (Crash stack traces and warnings are stored strictly in local cache `cache/logs/last_crash.txt` with billing tokens redacted, and are only shared if the user explicitly taps **Settings → Generate Log Files** and chooses to send an email).
