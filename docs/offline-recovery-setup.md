# Experimental activation without an external Wi-Fi network

This optional wa-reco feature is experimental. It depends on the phone's Android build and may stop working after a system update. It restores an authorized recorder component; it does not start recording a call or automatically arm microphone recording after reboot.

## English

1. Complete the normal guided setup while connected to Wi-Fi: enable Developer options and Wireless debugging, pair this installation and activate the recorder.
2. In Settings, expand **Activate without a Wi-Fi network** and press **One-time preparation**. This section is available even while the recorder is already connected. Read and approve its explanation. During an authorized local ADB connection, wa-reco grants its own installation permission to change the debugging setting. This is a special setup step, not an ordinary Android permission dialog. Keep the app visible until preparation finishes. The next button becomes **Grant Wi-Fi permission**; press it and allow Nearby devices when Android asks. The secondary switch remembers your preference; it does not activate the recorder.
3. After a phone restart, unlock the phone and open wa-reco. Enable the Wi-Fi radio if requested; an external Wi-Fi network is not needed for this experiment. Press **Activate recorder component** and keep the app visible.
4. wa-reco temporarily requests a local hotspot and attempts the saved authenticated connection. Cancel is available. Success is shown only after its hotspot is released, the original debugging setting is restored and the detached recorder remains authenticated and active.
5. Press **Continue to automatic recording setup** and enable automatic recording from the visible app if needed. An activation failure includes a repair action. Use normal Wi-Fi activation when this experimental method is unsupported on the phone.

Version 1.5.11 also uses already-prepared local recovery when you explicitly activate the component, enable automatic recording or start paired manual recording with no live helper. Activate before starting a call: recovery cannot create a hotspot during an existing call. A live authenticated helper needs no new connection and continues without external Wi-Fi. The Home automatic-status card opens setup when reactivation is needed. Cancel revokes a pending recovery's follow-up recording/automatic action; no retry or fallback starts silently.

Version 1.5.12 adds a restart reminder when paired automatic recording was already enabled. After unlocking the phone, tap **Resume automatic recording** in the notification and keep wa-reco visible while it restores the component and verifies readiness. This tap restores your existing choice; ordinary app launches do not arm Auto. Notification permission and the restart-reminder channel must be allowed in Android. If permissions were revoked, Wi-Fi is off, setup is incomplete or a call is already active, follow the displayed repair step and explicitly retry. The boot event only posts a notification: it does not start audio, a helper, a hotspot or a microphone foreground service. A notification is not proof that recording is ready. Device reboot/reminder acceptance remains separate from automated tests.

While an attempt is running, use **Cancel activation** first; then turn the option off to prevent future attempts. Turning it off does not necessarily revoke the special permission Android granted during preparation; the app checks the option before using it. Uninstalling removes this installation's access, private pairing identity and local recordings. Recordings remain private to the app unless you explicitly enable a backup or share them.

## עברית

בגרסה 1.5.12 תופיע תזכורת אחרי ריסטרט אם ההקלטה האוטומטית במסלול הצימוד הייתה מופעלת קודם. אחרי פתיחת הטלפון, לחצו בהתראה על **״חידוש הקלטה אוטומטית״** והשאירו את wa-reco פתוחה עד לבדיקת המוכנות. הלחיצה מחדשת את הבחירה הקודמת; פתיחה רגילה של האפליקציה אינה מפעילה הקלטה אוטומטית. הרשאת ההתראות וערוץ התזכורת צריכים להיות מאושרים בהגדרות Android. אם חסרה הרשאה, ה־Wi-Fi בטלפון כבוי, ההכנה חסרה או שכבר יש שיחה פעילה, השלימו את השלב שמוצג ונסו שוב בלחיצה מפורשת. ההתראה עצמה אינה מפעילה הקלטה או רכיב חיבור, ואינה הוכחה שההקלטה מוכנה. בדיקת ריסטרט אמיתית בכל טלפון עדיין נדרשת.

1. השלימו פעם אחת את אשף ההגדרה הרגיל בחיבור ל־Wi-Fi: אפשרויות מפתח, ניפוי באגים אלחוטי, צימוד והפעלת רכיב ההקלטה.
2. בהגדרות הרחיבו את **״הפעלה בלי רשת Wi-Fi״** ולחצו על **״הכנה חד-פעמית״**. האפשרות זמינה גם כשהרכיב כבר מחובר. קראו ואשרו את ההסבר. בזמן החיבור המאושר, האפליקציה מעניקה להתקנה שלה הרשאה מיוחדת לשינוי הגדרת ניפוי הבאגים. השאירו אותה פתוחה עד לסיום ההכנה. הכפתור הבא הוא **״אישור הרשאת Wi-Fi״**; לחצו עליו ואשרו ״מכשירים בקרבת מקום״ כש־Android מבקש. המתג המשני שומר את בחירתכם ואינו מפעיל את רכיב ההקלטה.
3. אחרי ריסטרט פתחו את הטלפון ואת wa-reco. אם התבקשתם, הפעילו את רכיב ה־Wi-Fi בטלפון; הניסוי אינו דורש התחברות לרשת חיצונית. לחצו על **״הפעלת רכיב ההקלטה״** והשאירו את האפליקציה פתוחה.
4. האפליקציה יוצרת נקודה חמה מקומית זמנית ומנסה להתחבר באמצעות הצימוד השמור. אפשר לבטל. הצלחה תוצג רק לאחר סגירת הנקודה החמה, החזרת הגדרת ניפוי הבאגים למצב הקודם ובדיקה שרכיב ההקלטה נשאר פעיל ומאומת.
5. לחצו על **״המשך להגדרת ההקלטה האוטומטית״** והפעילו הקלטה אוטומטית מתוך האפליקציה, אם רצונכם בכך. אם הניסוי נכשל במכשיר שלכם, ההפעלה הרגילה דרך Wi-Fi נשארת זמינה.

בגרסה 1.5.11, לאחר השלמת ההכנה, גם לחיצה מפורשת להפעלת הרכיב, להפעלת הקלטה אוטומטית או להקלטת שיחה ידנית משתמשת בחיבור המקומי אם הרכיב אינו פעיל. הפעילו לפני השיחה: לא יוצרים נקודה חמה בזמן שיחה פעילה. כשהרכיב כבר פעיל, אין צורך בחיבור חדש או ברשת Wi-Fi חיצונית. במסך הראשי מופיע מצב ההקלטה האוטומטית עם מעבר להגדרה מחדש. ביטול ההפעלה מבטל גם את המשך פעולת ההקלטה או ההפעלה האוטומטית שהמתינה לה; אין מעבר שקט למסלול אחר.

בזמן ניסיון פעיל לחצו תחילה על **״ביטול ההפעלה״**; לאחר מכן אפשר לכבות את המתג כדי למנוע ניסיונות נוספים. ההרשאה המיוחדת אינה בהכרח מתבטלת ב־Android בעקבות כיבוי האפשרות; האפליקציה בודקת שהאפשרות מופעלת לפני שימוש בה. ההפעלה אינה מקליטה אודיו. התאוששות מלאה ללא פתיחת האפליקציה אחרי אתחול אינה יכולת מאומתת.

Research evidence and device-report limits: [offline restart research](offline-reboot-research.md).
