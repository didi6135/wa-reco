# Historical accessibility microphone experiment

Versions 1.5.7–1.5.9 offered an optional microphone recording experiment using a genuinely approved accessibility service. Version 1.5.10 returns to the paired wireless-debugging call connection at the owner's request after a missing-remote-voice report on another phone. The experiment is no longer selectable in normal setup or call controls.

The experiment used ordinary mono VOICE_RECOGNITION. It had no separate digital call-output channel and saved remoteAudioVerified=false. A local voice, nonzero levels or a saved file did not verify remote speech. Any audible remote input could be acoustic or specific to a phone/audio route. Earlier owner acceptance did not establish other phones or headset compatibility.

Existing experimental recordings remain available with their original source and unverified-remote-audio labels. A legacy installation is guided through an explicit guarded return to system mode; recordings, accounts and pairing are kept. Automatic recording is disarmed and must be separately enabled. No polling, service connection or boot event performs the mode change.

The legacy service definition and metadata reader remain for compatibility; current setup does not ask for accessibility approval. It does not read screen/window content, subscribe to UI events or automate Android approval. Microphone-sharing accessibility does not grant protected digital downlink capture. [Android input sharing](https://developer.android.com/media/platform/sharing-audio-input)

## עברית

ניסוי הנגישות והמיקרופון בגרסאות 1.5.7–1.5.9 אינו מוצע עוד. בגרסה 1.5.10 חוזרים לחיבור השיחות עם צימוד דרך ניפוי באגים אלחוטי, בעקבות דיווח על צד שני שלא נשמע בטלפון אחר.

הניסוי השתמש במיקרופון בלבד, ללא ערוץ נפרד לקול שמגיע מהשיחה. ההקלטות הישנות נשמרות עם סימון שהצד השני לא אומת. התקנות שהפעילו את הניסוי מקבלות פעולה מפורשת לחזרה למסלול הקודם; ההקלטות והצימוד נשמרים והמצב האוטומטי דורש הפעלה נפרדת.

ראו [הקמה נוכחית](clean-setup.md) ו[הפעלה אחרי אתחול](offline-recovery-setup.md). יש לבדוק ששני הצדדים נשמעים בכל מכשיר ואופן שימוש; חיבור תקין אינו אישור להקלטת שני הצדדים.
