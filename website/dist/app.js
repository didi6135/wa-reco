(() => {
  'use strict';
  const messages = {
    he: {
      documentTitle: 'wa-reco — השיחה נגמרת. הפרטים נשארים.', description: 'wa-reco — שיחות WhatsApp, מסודרות אצלכם. הקלטה במכשירי Android שנבדקו, קבצים מקומיים וקוד פתוח.',
      navigation: 'ניווט ראשי', language: 'שפת האתר', menuOpen: 'פתיחת התפריט', menuClose: 'סגירת התפריט', skip: 'דילוג לתוכן', navExperience: 'האפליקציה', navSetup: 'איך מתחילים', navCompatibility: 'התאמה למכשיר', navSource: 'קוד פתוח ↗',
      eyebrow: 'ל־Android. בקוד פתוח. בשליטה שלכם.', heroLine1: 'השיחה נגמרת.', heroLine2: 'הפרטים נשארים.', heroDescription: 'שיחות WhatsApp, מסודרות אצלכם. מקליטים כשצריך, מוצאים לפי שם ומאזינים מחדש — באפליקציה פשוטה שהקבצים שלה נשארים במכשיר.', heroDownload: 'הורדה ל־Android', heroGuide: 'מדריך ההפעלה', heroPackage: 'קובץ APK, ללא חנות אפליקציות', heroNote: 'הקלטה אוטומטית ושמות שיחות נבדקו עם המשתמש על Samsung S26 Ultra עם Android 16.',
      appIllustration: 'המחשה של האפליקציה', illustrationTabs: 'מסכי ההמחשה', tabRecord: 'הקלטה', tabLibrary: 'ההקלטות שלי', tabSettings: 'הגדרות', floatingTitle: 'שמורה. מסודרת. שלכם.', floatingBody: 'אפשר למצוא את השיחה לפי שם', illustrationCaption: 'המחשה אינטראקטיבית עם פרטי דוגמה. אין כאן הקלטה או שמע.', heroBottom: 'פשוט בשימוש היומיומי. ברור מההפעלה הראשונה.', explore: 'הכירו את האפליקציה',
      experienceEyebrow: 'מקום אחד לכל השיחות', experienceTitle: 'שלושה מסכים.\nבלי להסתבך.', experienceIntro: 'מכפתור ההקלטה ועד השיחה שחיפשתם. כל מה שצריך נמצא מולכם, והגדרות ההפעלה נשארות במקום שלהן.', experienceChoices: 'בחרו מסך להמחשה', flowRecordTitle: 'מקליטים, בדרך שלכם', flowRecordBody: 'כפתור להקלטה ידנית, או זיהוי שיחת WhatsApp והקלטה אוטומטית כשהמצב מופעל והשירות מוכן.', flowLibraryTitle: 'מוצאים את השיחה', flowLibraryBody: 'הקלטות מסודרות עם שם, זמן ומשך. מאזינים, משתפים או מוחקים — מתוך הספרייה שלכם.', flowSettingsTitle: 'יודעים שהכול מוכן', flowSettingsBody: 'מצב ההרשאות והשירות, שמירת שמות וגיבויים. רואים מה מחובר ומה עדיין צריך להשלים.', exploreScreen: 'הצגת המסך',
      sampleLabel: 'קובץ לדוגמה', sampleCall: 'שיחה עם נועה', namesEyebrow: 'גם לשיחה יש שם', namesTitle: 'פחות ״איזה קובץ זה?״.\nיותר ״הנה השיחה״.', namesBody: 'מפעילים שמירת שמות בהגדרות, ושיחות חדשות יכולות לקבל את השם ש־WhatsApp מציגה. השם מופיע בכותרת ההקלטה וגם בקובץ שמשתפים או מגבים.', namesNote: 'כבוי כברירת מחדל. אם אין שם ברור משיחה פעילה אחת, נשמר שם כללי. השם הוא תווית מ־WhatsApp, לא אימות זהות.',
      setupEyebrow: 'מההורדה לשיחה הראשונה', setupTitle: 'הפעלה ראשונה.\nצעד אחר צעד.', setupIntro: 'יש כמה הגדרות ש־Android דורשת להקלטת שיחות. האשף באפליקציה מלווה אתכם בכל שלב — בלי Root, בלי מחשב ובלי אפליקציה נוספת.', checkCompatibility: 'קודם בודקים התאמה', setupNotice: 'לפני שיחת הבדיקה, יידעו את המשתתפים שהיא מוקלטת. להקלטת מיקרופון רגילה אפשר לדלג על חיבור שירות השיחות.', installTitle: 'מורידים ומתקינים', installBody: 'מורידים את קובץ ה־APK ופותחים אותו בטלפון. אם Android מבקש, מאשרים התקנה מהדפדפן או ממנהל הקבצים שבו פתחתם אותו.', installLink: 'לקובץ ההתקנה ↓', permissionsTitle: 'נותנים את ההרשאות', permissionsBody: 'פותחים את wa-reco ועוקבים אחר האשף. הוא מבקש מיקרופון והתראות. כדי לזהות שיחות אוטומטית, מאשרים בנפרד גם גישה להתראות של Android.', activationTitle: 'מחברים את שירות השיחות', activationBody: 'מתחברים ל־Wi-Fi ועוקבים אחר הוראות ההפעלה באפליקציה: אפשרויות מפתחים, ניפוי באגים אלחוטי וקוד זיווג. ממשיכים כשהשירות מציג ״מחובר ומוכן״.', activationDetails: 'מה עושים בהגדרות הטלפון?', developerStep: 'פותחים הגדרות ← אודות הטלפון ← מידע תוכנה. לוחצים שבע פעמים על מספר גרסת Build. שמות התפריטים עשויים להשתנות בין מכשירים.', wifiStep: 'באפשרויות מפתחים מפעילים ״ניפוי באגים אלחוטי״, בזמן שהטלפון מחובר ל־Wi-Fi.', pairStep: 'פותחים ״זיווג באמצעות קוד״ ומזינים באשף wa-reco את הפרטים שהוא מבקש. קוד הזיווג זמני ואין לשתף אותו.', helperStep: 'חוזרים לאפליקציה ומפעילים את השירות. בודקים שבהגדרות האפליקציה הוא מופיע כמחובר ומוכן.', firstCallTitle: 'עושים שיחת בדיקה קצרה', firstCallBody: 'מפעילים הקלטה אוטומטית בהגדרות ומבצעים שיחת WhatsApp קצרה בידיעת המשתתף. אחרי הניתוק, פותחים את ההקלטה ובודקים ששני הצדדים נשמעים. אפשר להקליט גם ידנית.', wifiNoteTitle: 'יוצאים מהבית? ההקלטה יכולה להמשיך.', wifiNoteBody: "Wi-Fi נדרש להפעלה הראשונית. כל עוד שירות ההקלטה פעיל ומוכן, אפשר להקליט בלי Wi-Fi. אחרי אתחול נדרשת הפעלה מחדש מתוך האפליקציה; גרסה 1.5.12 יכולה להציג תזכורת לכך. שחזור מקומי ניסיוני שהוכן מראש יכול לפעול בלי רשת Wi-Fi חיצונית, אך מחייב רדיו Wi-Fi פעיל ואישורי Android. יש להשלים את ההפעלה לפני השיחה. שיחת WhatsApp עצמה דורשת אינטרנט.",
      backupEyebrow: 'הקלטות מקומיות. הבחירה שלכם.', backupTitle: 'הקובץ אצלכם.\nהגיבוי לבחירתכם.', backupIntro: 'לא צריך חשבון ענן כדי לשמור ולהאזין. הקבצים נשמרים באפליקציה. אם תרצו גיבוי, תחברו את החשבון שלכם ותפעילו אותו בעצמכם.', privacyLink: 'איך אנחנו מתייחסים לפרטיות', localTitle: 'נשמר במכשיר', localBody: 'האזנה, שיתוף ומחיקה — בלי לחבר חשבון.', localTag: 'ברירת המחדל', optionalBackup: 'גיבוי חיצוני — רק כשבוחרים להפעיל', driveBody: 'מחברים את חשבון Google שלכם ובוחרים תיקייה. העלאה לתיקייה שנבחרה אומתה על המכשיר שנבדק בגרסה 1.5.2.', verificationDetails: 'פרטי הבדיקה', driveVerification: 'העלאת קבצים עם שמות השיחות החדשים, תיקיית ברירת המחדל וחשבונות של משתמשים נוספים עדיין דורשים בדיקה.', telegramBody: 'מחברים בוט אישי משלכם, ישירות מהטלפון וללא שרת. הגיבוי זמין באפליקציה; העלאה אמיתית מהמכשיר ל־Telegram עדיין ממתינה לאימות.',
      compatibilityEyebrow: 'לפני שמורידים', compatibilityTitle: 'המכשיר שלכם.\nהאפשרויות שלו.', compatibilityIntro: 'הקלטת שיחות תלויה בגרסת Android ובחומרת הטלפון. ההתקנה מיועדת למכשירי ARM64 מ־Android 7 ומעלה. כדאי לבצע שיחת בדיקה במכשיר שלכם.', testedBody: 'הקלטת שיחות, הפעלה אוטומטית ושמירת שם השיחה אושרו בבדיקה עם המשתמש.', testedTag: 'נבדק בפועל', experimentalBody: 'מסלול ניסיוני. דורש הפעלה ובדיקת הקלטה במכשיר, כולל האזנה לשני הצדדים.', experimentalTag: 'ניסיוני', olderBody: 'הקלטת מיקרופון בלבד. אין במסלול הישן הקלטת שני צדי שיחת WhatsApp באותו מכשיר.', olderTag: 'מיקרופון בלבד', iphoneBody: 'אין באפליקציה מסלול מקביל להקלטת שיחת WhatsApp באותו iPhone.', iphoneTag: 'ללא תמיכה בשיחות', micNote: 'מיקרופון רגיל עשוי להיות מושתק בזמן שיחה. בדיקה של דגם אחד אינה מבטיחה תמיכה בכל המכשירים.',
      faqEyebrow: 'טוב לדעת', faqTitle: 'כמה תשובות,\nלפני השיחה.', faqWifiQuestion: 'צריך להיות מחוברים ל־Wi-Fi כל הזמן?', faqWifiAnswer: "לא בזמן ששירות ההקלטה כבר פעיל ומוכן. אחרי אתחול או אובדן השירות יש לפתוח את האפליקציה ולהפעיל מחדש לפני השיחה. אם הכנתם מראש את השחזור המקומי הניסיוני, אפשר לנסות זאת ללא רשת Wi-Fi חיצונית. תזכורת האתחול של 1.5.12 פותחת את ההגדרה ומנסה לשחזר הקלטה אוטומטית שהופעלה קודם; Android עשוי לדרוש אישור נוסף וניסיון חוזר. האתחול לבדו אינו מתחיל הקלטה.", faqDebugQuestion: 'למה צריך אפשרויות מפתחים?', faqDebugAnswer: 'הרשאות רגילות של אפליקציה לא מספיקות למסלול הקלטת השיחות הזה. ניפוי באגים אלחוטי מאפשר להפעיל בטלפון את השירות הדרוש. האשף מסביר איך ומציג אם השירות באמת מוכן.', faqNamesQuestion: 'מאיפה מגיע שם השיחה?', faqNamesAnswer: 'רק אם מפעילים שמירת שמות, wa-reco משתמשת בתווית ש־WhatsApp מספקת עבור שיחה פעילה אחת בתחילת ההקלטה. אין קריאה של ספר אנשי הקשר או של תוכן הודעות. אם אין תווית ברורה, ההקלטה נשמרת בשם כללי. השינוי חל על שיחות חדשות בלבד.', faqBackupQuestion: 'האם הקלטות עולות אוטומטית לענן?', faqBackupAnswer: 'כברירת מחדל הן נשארות במכשיר. גיבוי ל־Drive או ל־Telegram דורש חיבור חשבון אישי והפעלה מפורשת של גיבוי הקלטות קיימות ועתידיות. חיבור החשבון לבדו לא מפעיל העלאה. אם שמירת שמות מופעלת, השם עשוי להופיע גם בקובץ שנשלח לגיבוי.', faqStoreQuestion: 'איך מתקינים בלי Google Play?', faqStoreAnswer: 'מורידים כאן את קובץ ההתקנה APK ופותחים בטלפון Android. Android עשויה לבקש אישור התקנה ממקור זה. לאחר ההתקנה פותחים את wa-reco ומשלימים את אשף ההפעלה. הקוד וחבילת הרישיונות של אותה גרסה זמינים לצד ההורדה.',
      downloadEyebrow: 'wa-reco ל־Android', downloadTitle: 'השיחה הבאה.\nכבר מסודרת.', downloadIntro: 'בדקו התאמה, הורידו את האפליקציה ותנו לאשף ללוות אתכם בהפעלה הראשונה.', downloadGuide: 'חזרה למדריך ההתקנה ↑', downloadPending: 'הורדה ממתינה לפרסום', downloadReady: 'הורדת APK ל־Android ↓', releasePending: 'קישור ההורדה יופעל לאחר אימות נתוני הגרסה.', releaseReady: 'קובץ ההתקנה זמין. אפשר להשוות את טביעת SHA-256 לאחר ההורדה.', releaseVersion: 'גרסה', releaseSize: 'גודל קובץ', releasePlatform: 'פלטפורמה', releasePanelLabel: 'קוד פתוח. קבצים מקומיים.', copyHash: 'העתקת טביעת הקובץ', copyDone: 'טביעת הקובץ הועתקה.', copyFallback: 'טביעת הקובץ סומנה. אפשר להעתיק אותה ידנית.', openSourceNote: 'אפשר לראות את הקוד, ללמוד ממנו ולבנות בעצמכם.', sourcesEyebrow: 'לאותה גרסה שאתם מורידים', sourcesTitle: 'הקוד. הרישיונות. כל הפרטים.', sourcesBody: 'חבילת המקור והרישיונות כוללת הודעות רישוי והנחיות לבנייה מחדש ולהחלפת רכיבי LGPL. הקישורים וטביעות הקבצים מתייחסים לגרסה המוצגת כאן.', companionDownload: 'מקור, רישיונות והנחיות בנייה', applicationSourceDownload: 'קוד האפליקציה המדויק', exactSource: 'המקור המדויק ב־GitHub', sourceChecksums: 'גדלים וטביעות קובץ', companionLabel: 'חבילת מקור ורישיונות', applicationSourceLabel: 'מקור האפליקציה', footerNote: 'פרויקט עצמאי בקוד פתוח. אינו מוצר של WhatsApp או Meta.', privacy: 'פרטיות', terms: 'תנאי שימוש', footerSource: 'קוד פתוח ↗', reportIssue: 'דיווח על בעיה ↗', noScript: 'החלפת שפה והמחשת האפליקציה דורשות JavaScript. מדריך ההתקנה מופיע כאן; אפשר למצוא קבצים בגרסאות הפרויקט ב־GitHub.',
      mockSource: 'מקור ההקלטה', mockMic: 'מיקרופון', mockCall: 'שיחת WhatsApp', mockStart: 'מוכנים לשיחה', mockStartBody: 'כפתור אחד להקלטה ידנית.', mockActive: 'הקלטה לדוגמה', mockActiveBody: 'המחשה בלבד — המיקרופון לא מופעל.', mockRecordButton: 'הדגמת התחלת הקלטה', mockStopButton: 'הדגמת עצירת הקלטה', mockDefaultNote: 'לחצו על הכפתור כדי לנסות.', mockSaved: 'ההמחשה הסתיימה. לא נוצר קובץ.', mockLibraryHeading: 'ההקלטות שלי', mockCount: '3 הקלטות', mockCallNames: ['שיחה עם נועה', 'שיחה עם דניאל', 'הקלטת מיקרופון'], mockLocal: 'היום · קובץ מקומי', mockSavedTag: 'נשמרה', mockFilesNote: 'שמות ופרטים לדוגמה. אין שמע להשמעה.', mockReadiness: 'מוכנות להקלטה', mockChecks: ['מיקרופון', 'גישה להתראות', 'חיבור לשירות', 'הקלטה אוטומטית', 'שמירת שמות'], mockReady: 'מוכן', mockEnabled: 'מופעל', mockSettingsNote: 'מצב מוכנות לדוגמה בלבד.'
    },
    en: {
      documentTitle: 'wa-reco — The call ends. The details stay.', description: 'wa-reco — Your WhatsApp calls, organized. Recording on tested Android devices, local files, and open source.',
      navigation: 'Main navigation', language: 'Website language', menuOpen: 'Open navigation', menuClose: 'Close navigation', skip: 'Skip to content', navExperience: 'The app', navSetup: 'Get started', navCompatibility: 'Compatibility', navSource: 'Open source ↗',
      eyebrow: 'For Android. Open source. Yours to control.', heroLine1: 'The call ends.', heroLine2: 'The details stay.', heroDescription: 'Your WhatsApp calls, organized. Record when you need to, find a call by name, and listen again — in a simple app that keeps your files on your device.', heroDownload: 'Download for Android', heroGuide: 'Setup guide', heroPackage: 'APK file, without an app store', heroNote: 'Automatic recording and call names were tested with the owner on Samsung S26 Ultra running Android 16.',
      appIllustration: 'App illustration', illustrationTabs: 'Illustrative app screens', tabRecord: 'Record', tabLibrary: 'Recordings', tabSettings: 'Settings', floatingTitle: 'Saved. Organized. Yours.', floatingBody: 'Find the call by name', illustrationCaption: 'Interactive illustration with sample details. No recording or audio here.', heroBottom: 'Simple every day. Clear from the first setup.', explore: 'Explore the app',
      experienceEyebrow: 'One place for your calls', experienceTitle: 'Three screens.\nA little less effort.', experienceIntro: 'From the recording button to the call you were looking for. Everyday tools are right in front of you, with setup kept in its own place.', experienceChoices: 'Choose a screen to illustrate', flowRecordTitle: 'Record your way', flowRecordBody: 'Tap to record manually, or detect a WhatsApp call and record automatically when enabled and the helper is ready.', flowLibraryTitle: 'Find the conversation', flowLibraryBody: 'Recordings organized by name, time, and duration. Listen, share, or delete, right from your library.', flowSettingsTitle: 'Know you are ready', flowSettingsBody: 'Permissions, helper status, call names, and backups. See what is connected and what still needs attention.', exploreScreen: 'Explore this screen',
      sampleLabel: 'Illustrative file', sampleCall: 'Call with Noa', namesEyebrow: 'Give the call a name', namesTitle: 'Less “which file was it?”\nMore “here it is.”', namesBody: 'Enable Save call names in Settings, and new calls can use the label supplied by WhatsApp. The name appears in the recording title and in files you share or back up.', namesNote: 'Off by default. A missing or unclear label from a single active call means a generic name is used. A WhatsApp label is not a verified identity.',
      setupEyebrow: 'From download to your first call', setupTitle: 'First setup.\nOne step at a time.', setupIntro: 'Android requires a few settings for call recording. The in-app wizard guides you through them — without root, a computer, or another app.', checkCompatibility: 'Check compatibility first', setupNotice: 'Before your test call, let the participants know it is being recorded. For ordinary microphone recording, you can skip call helper activation.', installTitle: 'Download and install', installBody: 'Download the APK and open it on your phone. If Android asks, allow installation from the browser or file manager you used to open it.', installLink: 'Get the installation file ↓', permissionsTitle: 'Grant the permissions', permissionsBody: 'Open wa-reco and follow the wizard. It asks for microphone and notification permissions. To detect calls automatically, separately grant Android notification access.', activationTitle: 'Connect the call helper', activationBody: 'Connect to Wi-Fi and follow the in-app instructions: Developer options, Wireless debugging, and a pairing code. Continue when the helper shows “connected and ready.”', activationDetails: 'What do I do in phone Settings?', developerStep: 'Open Settings → About phone → Software information. Tap Build number seven times. Menu names may vary between devices.', wifiStep: 'In Developer options, enable Wireless debugging while your phone is connected to Wi-Fi.', pairStep: 'Open “Pair device with pairing code” and enter the requested details in the wa-reco wizard. The pairing code is temporary; do not share it.', helperStep: 'Return to the app and start the helper. Check that it appears connected and ready in app Settings.', firstCallTitle: 'Make a short test call', firstCallBody: 'Enable automatic recording in Settings and make a short WhatsApp call with the participant’s knowledge. After hanging up, open the recording and check that both voices are audible. Manual recording is available too.', wifiNoteTitle: 'Heading out? Recording can continue.', wifiNoteBody: "Wi-Fi is needed for initial activation. While the helper is running and ready, recording can continue without Wi-Fi. After a reboot, reactivate from the app; version 1.5.12 can show a reminder. Experimental local recovery prepared in advance can work without an external Wi-Fi network, but requires the Wi-Fi radio and Android approvals. Complete activation before the call. WhatsApp itself still needs Internet access.",
      backupEyebrow: 'Local recordings. Your choice.', backupTitle: 'Your file.\nYour backup choice.', backupIntro: 'You do not need a cloud account to save and listen. Files stay in the app. If you want backup, connect your own account and explicitly enable it.', privacyLink: 'How we approach privacy', localTitle: 'Saved on your device', localBody: 'Listen, share, and delete — without connecting an account.', localTag: 'The default', optionalBackup: 'External backup — only when you enable it', driveBody: 'Connect your own Google account and select a folder. Uploading to a chosen folder was verified on the tested device in version 1.5.2.', verificationDetails: 'What was tested?', driveVerification: 'Uploads with the new call names, the default folder, and additional users’ accounts still need testing.', telegramBody: 'Connect your own personal bot, directly from your phone with no server. Backup is implemented; a real device upload to Telegram is still awaiting verification.',
      compatibilityEyebrow: 'Before you download', compatibilityTitle: 'Your device.\nIts possibilities.', compatibilityIntro: 'Call recording depends on your Android version and phone hardware. Installation is for ARM64 devices running Android 7 or later. Make a test call on your own phone.', testedBody: 'Call recording, automatic start, and call names were confirmed in testing with the owner.', testedTag: 'Tested on device', experimentalBody: 'Experimental route. Requires activation and a recording test on your device, including listening to both voices.', experimentalTag: 'Experimental', olderBody: 'Microphone recording only. The older route does not record both sides of a WhatsApp call on the same device.', olderTag: 'Microphone only', iphoneBody: 'The app has no equivalent route for recording a WhatsApp call on the same iPhone.', iphoneTag: 'No call support', micNote: 'Ordinary microphone recording may be silenced during a call. A test on one model does not guarantee support for all devices.',
      faqEyebrow: 'Good to know', faqTitle: 'A few answers.\nBefore the call.', faqWifiQuestion: 'Do I need to stay on Wi-Fi?', faqWifiAnswer: "Not while the helper is already running and ready. After a reboot or helper loss, open the app and reactivate before the call. If experimental local recovery was prepared in advance, you can try without an external Wi-Fi network. The 1.5.12 reboot reminder opens setup and attempts to restore previously enabled automatic recording; Android may require another approval and an explicit retry. A reboot alone never starts recording.", faqDebugQuestion: 'Why do I need Developer options?', faqDebugAnswer: 'Ordinary app permissions are not enough for this call recording route. Wireless debugging lets you start the required helper on the phone. The wizard explains how and shows whether it is actually ready.', faqNamesQuestion: 'Where does the call name come from?', faqNamesAnswer: 'Only when Save call names is enabled, wa-reco uses the WhatsApp label for a single active call at the start of recording. It does not read your contacts database or message content. Without a clear label, it uses a generic name. This affects new calls only.', faqBackupQuestion: 'Do recordings automatically go to the cloud?', faqBackupAnswer: 'By default, they stay on the device. Drive or Telegram backup needs a personal account connection and an explicit choice to back up existing and future recordings. Connecting alone does not enable uploads. If call names are enabled, the name may also appear in the file sent to the backup service.', faqStoreQuestion: 'How do I install without Google Play?', faqStoreAnswer: 'Download the APK here and open it on your Android phone. Android may ask you to allow installation from that source. Open wa-reco afterward and complete the setup wizard. The code and license package for the same release are available beside the download.',
      downloadEyebrow: 'wa-reco for Android', downloadTitle: 'Your next call.\nAlready organized.', downloadIntro: 'Check compatibility, download the app, and let the wizard guide you through the first setup.', downloadGuide: 'Back to the installation guide ↑', downloadPending: 'Download awaiting release', downloadReady: 'Download Android APK ↓', releasePending: 'The download link becomes active after release metadata is validated.', releaseReady: 'The installation file is available. Compare the SHA-256 checksum after downloading.', releaseVersion: 'Version', releaseSize: 'File size', releasePlatform: 'Platform', releasePanelLabel: 'Open source. Local files.', copyHash: 'Copy file checksum', copyDone: 'File checksum copied.', copyFallback: 'File checksum selected. You can copy it manually.', openSourceNote: 'Read the code, learn from it, and build it yourself.', sourcesEyebrow: 'For the release you download', sourcesTitle: 'The code. The licenses. The details.', sourcesBody: 'The source and notices package includes license notices and instructions for rebuilding and replacing LGPL components. These links and checksums refer to the release shown here.', companionDownload: 'Source, notices & rebuild instructions', applicationSourceDownload: 'Exact application source', exactSource: 'Exact release source on GitHub', sourceChecksums: 'File sizes and checksums', companionLabel: 'Source and notices package', applicationSourceLabel: 'Application source', footerNote: 'An independent open-source project. Not a WhatsApp or Meta product.', privacy: 'Privacy', terms: 'Terms of use', footerSource: 'Open source ↗', reportIssue: 'Report an issue ↗', noScript: 'The language switch and app illustration need JavaScript. The installation guide is available here; find files in the project releases on GitHub.',
      mockSource: 'Recording source', mockMic: 'Microphone', mockCall: 'WhatsApp call', mockStart: 'Ready for the call', mockStartBody: 'One button for manual recording.', mockActive: 'Recording illustration', mockActiveBody: 'Illustration only — the microphone is not active.', mockRecordButton: 'Illustrate starting a recording', mockStopButton: 'Illustrate stopping a recording', mockDefaultNote: 'Tap the button to try it.', mockSaved: 'Illustration ended. No file was created.', mockLibraryHeading: 'Your recordings', mockCount: '3 recordings', mockCallNames: ['Call with Noa', 'Call with Daniel', 'Microphone recording'], mockLocal: 'Today · Local file', mockSavedTag: 'Saved', mockFilesNote: 'Sample names and details. No audio is available.', mockReadiness: 'Recording readiness', mockChecks: ['Microphone', 'Notification access', 'Helper connection', 'Automatic recording', 'Save call names'], mockReady: 'Ready', mockEnabled: 'Enabled', mockSettingsNote: 'Illustrative readiness only.'
    }
  };

  let language = 'he', screen = 'library', demoRecording = false, demoStopped = false, release = null;
  const get = id => document.getElementById(id);
  const t = key => messages[language][key];
  const element = (tag, className, text) => {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  };
  function wave(className, count, large = false) {
    const bar = element('div', className);
    bar.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < count; i++) {
      const item = element('span');
      const distance = Math.abs(i - (count - 1) / 2) / (count / 2);
      const height = large ? 28 + (1 - distance) * (100 + ((i * 17) % 105)) : 4 + ((i * 7 + (i % 5) * 3) % 17);
      item.style.height = `${height}px`;
      bar.append(item);
    }
    return bar;
  }
  const art = document.querySelector('.waveform-art');
  art.replaceWith(wave('waveform-art', 45, true));

  function renderScreen() {
    const panel = get('app-screen');
    panel.replaceChildren();
    get('screen-subtitle').textContent = t({record: 'tabRecord', library: 'tabLibrary', settings: 'tabSettings'}[screen]);
    panel.setAttribute('aria-labelledby', `phone-tab-${screen}`);
    document.querySelectorAll('[data-screen]').forEach(tab => {
      const selected = tab.dataset.screen === screen;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('[data-explore-screen]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.exploreScreen === screen)));
    if (screen === 'record') {
      panel.append(element('p', 'mock-source-label', t('mockSource')));
      const source = element('div', 'mock-source');
      source.append(element('span', '', t('mockMic')), element('span', '', t('mockCall')));
      const card = element('div', 'mock-card');
      card.append(element('h3', '', t(demoRecording ? 'mockActive' : 'mockStart')), element('p', '', t(demoRecording ? 'mockActiveBody' : 'mockStartBody')));
      const button = element('button', `mock-record${demoRecording ? ' active' : ''}`);
      button.type = 'button';
      button.setAttribute('aria-label', t(demoRecording ? 'mockStopButton' : 'mockRecordButton'));
      button.setAttribute('aria-pressed', String(demoRecording));
      button.addEventListener('click', () => {
        demoStopped = demoRecording;
        demoRecording = !demoRecording;
        renderScreen();
        panel.querySelector('button').focus({preventScroll: true});
      });
      const timer = element('p', 'mock-timer', demoRecording ? '00:07' : '00:00'); timer.dir = 'ltr';
      card.append(button, timer, element('p', '', t(demoStopped ? 'mockSaved' : 'mockDefaultNote')));
      panel.append(source, card);
    } else if (screen === 'library') {
      const top = element('div', 'mock-section-top');
      top.append(element('h3', '', t('mockLibraryHeading')), element('span', 'mock-count', t('mockCount')));
      const list = element('div', 'mock-list');
      ['02:34', '04:18', '00:42'].forEach((duration, index) => {
        const file = element('div', 'mock-file');
        const head = element('div', 'mock-file-title');
        const icon = element('span', 'mock-file-icon', index === 2 ? '◉' : '↗'); icon.setAttribute('aria-hidden', 'true');
        const details = element('div', 'mock-file-details');
        details.append(element('b', '', t('mockCallNames')[index]), element('p', '', t('mockLocal')));
        const time = element('span', 'mock-file-duration', duration); time.dir = 'ltr';
        head.append(icon, details, time); file.append(head);
        if (index === 0) {
          file.append(wave('mock-mini-wave', 30));
          const footer = element('div', 'mock-file-footer');
          footer.append(element('span', '', t('sampleLabel')), element('span', '', `✓ ${t('mockSavedTag')}`)); file.append(footer);
        }
        list.append(file);
      });
      panel.append(top, list, element('p', 'mock-note', t('mockFilesNote')));
    } else {
      const settings = element('div', 'mock-settings'); settings.append(element('h3', '', t('mockReadiness')));
      t('mockChecks').forEach((label, index) => {
        const row = element('div', 'mock-check');
        row.append(element('span', '', label), element('span', '', `✓ ${t(index < 3 ? 'mockReady' : 'mockEnabled')}`)); settings.append(row);
      });
      settings.append(element('p', 'mock-settings-footer', t('mockSettingsNote'))); panel.append(settings);
    }
  }

  const fileSize = value => `${(value / 1000000).toLocaleString(language === 'he' ? 'he-IL' : 'en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1})} MB`;
  function renderRelease() {
    const link = get('apk-download'), hero = get('hero-download');
    get('release-details').hidden = !release;
    get('release-sources').hidden = !release;
    link.textContent = t(release ? 'downloadReady' : 'downloadPending');
    get('release-status').textContent = t(release ? 'releaseReady' : 'releasePending');
    [link, hero].forEach(item => {
      item.classList.toggle('is-disabled', !release);
      item.setAttribute('aria-disabled', String(!release));
      item.tabIndex = release ? 0 : -1;
      if (release) { item.href = release.url; if (release.filename) item.setAttribute('download', release.filename); }
      else { item.removeAttribute('href'); item.removeAttribute('download'); }
    });
    document.querySelectorAll('[data-release-version]').forEach(node => { node.textContent = release ? release.version : '—'; });
    const sourceLink = get('application-source-download');
    [sourceLink, get('application-source-size-row'), get('application-source-hash-row')].forEach(node => { node.hidden = !(release && release.applicationSource); });
    if (!release) {
      ['companion-download', 'release-source', 'application-source-download'].forEach(id => { get(id).removeAttribute('href'); get(id).removeAttribute('download'); });
      return;
    }
    get('release-version').textContent = release.version;
    get('release-size').textContent = fileSize(release.sizeBytes);
    get('release-hash').textContent = release.sha256;
    const companion = get('companion-download'); companion.href = release.companion.url;
    if (release.companion.filename) companion.setAttribute('download', release.companion.filename);
    get('companion-size').textContent = fileSize(release.companion.sizeBytes);
    get('companion-hash').textContent = release.companion.sha256;
    get('release-source').href = release.sourceUrl;
    if (release.applicationSource) {
      sourceLink.href = release.applicationSource.url;
      if (release.applicationSource.filename) sourceLink.setAttribute('download', release.applicationSource.filename);
      get('application-source-size').textContent = fileSize(release.applicationSource.sizeBytes);
      get('application-source-hash').textContent = release.applicationSource.sha256;
    }
  }
  function setMenu(open) {
    get('main-nav').classList.toggle('is-open', open);
    get('menu-toggle').setAttribute('aria-expanded', String(open));
    get('menu-toggle').setAttribute('aria-label', t(open ? 'menuClose' : 'menuOpen'));
  }
  function setLanguage(next) {
    if (!(next in messages)) return;
    language = next;
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'he' ? 'rtl' : 'ltr';
    document.title = t('documentTitle');
    document.querySelector('meta[name="description"]').content = t('description');
    document.querySelector('meta[property="og:title"]').content = t('documentTitle');
    document.querySelector('meta[property="og:description"]').content = t('description');
    document.querySelectorAll('[data-i18n]').forEach(node => { const value = t(node.dataset.i18n); if (typeof value === 'string') node.textContent = value; });
    document.querySelectorAll('[data-i18n-aria]').forEach(node => node.setAttribute('aria-label', t(node.dataset.i18nAria)));
    document.querySelectorAll('[data-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === language)));
    setMenu(get('menu-toggle').getAttribute('aria-expanded') === 'true');
    try { localStorage.setItem('wa-reco-language', language); } catch (_) { /* Preference is optional. */ }
    renderScreen(); renderRelease();
  }
  function validateFile(value, extension) {
    if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0 || value.sizeBytes > 536870912
      || typeof value.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value.sha256) || typeof value.url !== 'string' || value.url.length > 2048) return null;
    let url; try { url = new URL(value.url, window.location.href); } catch (_) { return null; }
    const localRelative = !/^[A-Za-z][A-Za-z0-9+.-]*:|^\/\//.test(value.url) && url.origin === window.location.origin;
    if (url.username || url.password || url.hash || !url.pathname.toLowerCase().endsWith(extension) || (url.protocol !== 'https:' && !(localRelative && url.protocol === window.location.protocol))) return null;
    if (value.filename !== undefined && (typeof value.filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(apk|zip)$/.test(value.filename) || !value.filename.endsWith(extension))) return null;
    return {url: url.href, sizeBytes: value.sizeBytes, sha256: value.sha256.toLowerCase(), filename: value.filename};
  }
  function validateRelease(value) {
    if (!value || value.status !== 'ready' || typeof value.version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/.test(value.version)
      || typeof value.sourceUrl !== 'string' || !/^https:\/\/github\.com\/didi6135\/wa-reco\/tree\/[0-9a-f]{40}\/?$/.test(value.sourceUrl)) return null;
    const apk = validateFile(value, '.apk'), companion = validateFile(value.companion, '.zip');
    const applicationSource = value.applicationSource === undefined ? null : validateFile(value.applicationSource, '.zip');
    if (value.applicationSource !== undefined && !applicationSource) return null;
    return apk && companion ? {...apk, version: value.version, companion, applicationSource, sourceUrl: value.sourceUrl} : null;
  }
  document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => setLanguage(button.dataset.language)));
  get('menu-toggle').addEventListener('click', () => setMenu(get('menu-toggle').getAttribute('aria-expanded') !== 'true'));
  get('main-nav').querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && get('menu-toggle').getAttribute('aria-expanded') === 'true') { setMenu(false); get('menu-toggle').focus(); } });
  const tabs = Array.from(document.querySelectorAll('[data-screen]'));
  function selectTab(tab, focus = false) { screen = tab.dataset.screen; renderScreen(); if (focus) tab.focus(); }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else if (event.key === 'ArrowRight') next = (index + (language === 'he' ? -1 : 1) + tabs.length) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + (language === 'he' ? 1 : -1) + tabs.length) % tabs.length;
      else return;
      event.preventDefault(); selectTab(tabs[next], true);
    });
  });
  document.querySelectorAll('[data-explore-screen]').forEach(button => button.addEventListener('click', () => {
    const tab = tabs.find(item => item.dataset.screen === button.dataset.exploreScreen);
    selectTab(tab);
    get('app-screen').focus({preventScroll: true});
    document.querySelector('.app-figure').scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center'});
  }));
  get('copy-hash').addEventListener('click', async () => {
    if (!release) return;
    try { await navigator.clipboard.writeText(release.sha256); get('release-status').textContent = t('copyDone'); }
    catch (_) {
      const selection = window.getSelection(); if (selection) { const range = document.createRange(); range.selectNodeContents(get('release-hash')); selection.removeAllRanges(); selection.addRange(range); }
      get('release-status').textContent = t('copyFallback');
    }
  });
  try { const saved = localStorage.getItem('wa-reco-language'); if (saved === 'he' || saved === 'en') language = saved; } catch (_) { /* Hebrew is the default. */ }
  setLanguage(language);
  fetch('release-metadata.json', {cache: 'no-store'}).then(response => response.ok ? response.json() : null).then(value => { release = validateRelease(value); renderRelease(); }).catch(() => { release = null; renderRelease(); });
})();
