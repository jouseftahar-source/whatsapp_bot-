const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const P = require('pino');
const readline = require('readline');
const { exec, execFile } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const execFilePromise = util.promisify(execFile);
const ytdl_unused = null; // لم نعد نحتاج ytdl-core
const fs = require('fs');
const https = require('https');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// ==== رقمك كأدمن رئيسي للبوت ====
const ADMINS = ['213798943673@s.whatsapp.net', '213778949637@s.whatsapp.net'];

// ==== 👨‍💻 معلومات المطور (تظهر بأمر .المطور وبتذييل القائمة الرئيسية) ====
const DEVELOPER_NAME = '☬𝐊𝐇-𝐖𝐀𝐋𝐊𝐄𝐑☬';
const DEVELOPER_NUMBER = '213778949637';

// ==== 🏷️ اسم البوت الرسمي — يظهر بقائمة المساعدة وبيتحدث تلقائياً كاسم بروفايل واتساب عند الاتصال ====
const BOT_NAME = '☬𝐊𝐇-𝐖𝐀𝐋𝐊𝐄𝐑☬'; // نسخة مطوّلة فخمة (تستخدم بالرسائل)
const BOT_PROFILE_NAME = '☬𝐊𝐇-𝐖𝐀𝐋𝐊𝐄𝐑☬'; // نسخة مختصرة (واتساب بيحدد طول اسم البروفايل)

// ==== 📢 قناة واتساب الرسمية — تستخدم بأمر .قناتنا. البوت بيحاول يجيب بياناتها (متابعين/وصف) تلقائياً من واتساب،
// ولو فشلت المحاولة (نسخة قديمة من مكتبة Baileys مثلاً)، بيرجع تلقائياً للبيانات الثابتة تحت كاحتياط ====
const CHANNEL_INVITE_LINK = 'https://whatsapp.com/channel/0029VbCw70TJpe8mwhYegk2U';
const CHANNEL_INVITE_CODE = '0029VbCw70TJpe8mwhYegk2U';
const CHANNEL_NAME_FALLBACK = '☬𝐊𝐇-𝐖𝐀𝐋𝐊𝐄𝐑☬';
const CHANNEL_DESC_FALLBACK = 'قناتنا الرسمية على واتساب — تابعنا لآخر التحديثات والإصدارات الجديدة من البوت!';

// ==== خريطة معرفات @lid ⇦⇨ رقم الهاتف الحقيقي (لما واتساب ما يبعتش الرقم الحقيقي بالخاص) ====
// أضف هون أي معرف @lid يظهرلك بالـ debug، مقابل رقم صاحبه
const ADMIN_LID_MAP = {
  '107851594891386@lid': '213778949637',
};

// دالة توحّد أي جيد (رقم عادي أو @lid) لرقم الهاتف الحقيقي وحده
function resolveOwnerNumber(jid) {
  if (!jid) return null;
  if (ADMIN_LID_MAP[jid]) return ADMIN_LID_MAP[jid];
  return jid.split('@')[0];
}

// ==== مفتاح Google Gemini API (للدردشة الذكية) ====
const GEMINI_API_KEY = 'AQ.Ab8RN6KYAbRL6BjiLQi2PEJ32U1Nw2dtHVg60MeTqMZGQvu3jQ';

// ==== مفتاح Groq API (بديل/احتياطي سريع جداً للذكاء الاصطناعي) ====
const GROQ_API_KEY = 'xai-OpD65bDDc7URIX9UpRq6YvnymQwiSguJnFkRFomAbjRnP68F1w8iUa7wPAlM58atcKWCNiNb0357WUrm';

// ==== مفتاح Pexels API (لأمر .حزمة — صور حقيقية عالية الجودة) — خد مفتاحك المجاني من pexels.com/api وحطه هون ====
const PEXELS_API_KEY = 'ZGXkFuBCleJm3IW4WqIaDTh4hwuDUznEAPLZvuJC2UsVGI7EtbDdLzYG';

// ==== ⏱️ مهلة زمنية لأي طلب fetch (يلغي الطلب لو تأخر أكتر من كذا) ====
function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ==== 💤 وقفة صغيرة (مستخدمة بين محاولات إعادة الاتصال حتى ما نضرب الـ API بسرعة كبيرة) ====
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==== 🔁 استدعاء موديل Gemini واحد، مع إعادة محاولة تلقائية مرة وحدة لو صار خطأ اتصال (مش خطأ من الـ API نفسه) ====
// هاد بيرفع موثوقية الردود كتير: قبل كنا نطنش الموديل بالكامل لو صار أي هبوط اتصال بسيط، هلق منعطيه فرصة تانية.
async function callGeminiModelOnce(model, parts, timeoutMs) {
  let lastNetworkError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts }] }),
        },
        timeoutMs
      );

      const data = await res.json();

      if (data.error) {
        console.log(`⚠️ Gemini (${model}) رفض الطلب — الحالة: ${res.status} — الرسالة: ${data.error.message}`);
        // خطأ راجع من الـ API نفسه (مثلاً كوتا أو مفتاح) — ما في داعي نعيد المحاولة، منجرب موديل تاني مباشرة
        throw Object.assign(new Error(data.error.message || 'خطأ غير معروف من Gemini'), { retryable: false });
      }

      const candidate = data.candidates?.[0];
      const finishReason = candidate?.finishReason;
      const answer = candidate?.content?.parts?.[0]?.text;

      if (!answer) {
        console.log(`⚠️ Gemini (${model}) ما رجع نص. finishReason=${finishReason}`);
        throw Object.assign(
          new Error(finishReason === 'SAFETY' ? 'الرد اتوقف بسبب فلتر الأمان' : 'ما رجع رد من Gemini'),
          { retryable: false }
        );
      }

      return answer.trim();
    } catch (e) {
      if (e.retryable === false) throw e; // خطأ من الـ API، ما بنعيد نفس الموديل
      lastNetworkError = e;
      console.log(`⚠️ خطأ اتصال مع Gemini (${model}), محاولة ${attempt + 1}/2:`, e.message);
      if (attempt === 0) await sleep(700); // نستنى شوي ونعيد نفس الموديل مرة وحدة بس
    }
  }

  throw lastNetworkError || new Error('فشل الاتصال بـ Gemini');
}

// ==== 🤖 دالة استدعاء Groq (نموذج سريع جداً، تستخدم كبديل احتياطي لو Gemini وقع أو تأخر) ====
async function askGroq(promptText) {
  if (!GROQ_API_KEY) throw new Error('مفتاح GROQ_API_KEY مو معرّف بالكود');

  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: promptText }],
    }),
  }, 30000);

  const data = await res.json();
  if (data.error) {
    console.log(`⚠️ Groq رفض الطلب — الحالة: ${res.status} — الرسالة: ${data.error.message}`);
    throw new Error(data.error.message || 'خطأ غير معروف من Groq');
  }
  const answer = data.choices?.[0]?.message?.content;
  if (!answer) throw new Error('ما رجع رد من Groq');
  return answer.trim();
}

// ==== ⚠️ تحقق سريع من شكل مفتاح Groq عند الإقلاع — مفاتيح Groq الحقيقية تبدأ بـ gsk_، فلو شكل المفتاح مختلف (مثلاً xai- تبع X.AI) الرد الاحتياطي رح يفشل ====
if (GROQ_API_KEY && !GROQ_API_KEY.startsWith('gsk_')) {
  console.log(
    '⚠️ تنبيه: GROQ_API_KEY ما شكله متل مفتاح Groq حقيقي (المفروض يبدأ بـ gsk_). ' +
    'إذا الرد الاحتياطي لما Gemini يقع ما كان شغال، هاد على الأغلب السبب — روح console.groq.com واعمل مفتاح صحيح.'
  );
}

// ==== 🤖 دالة عامة لاستدعاء Gemini (نص فقط، أو نص+صورة لو زوّدتها imageBase64)
// تجرب أكتر من موديل بالترتيب (نفس فكرة askGeminiAudio) قبل ما تسلّم بالفشل، وبعدين لو الكل وقع بترجع لـ Groq (نصوص بس، ما بيدعم صور) ====
async function askGemini(promptText, imageBase64 = null, imageMimeType = 'image/jpeg') {
  if (!GEMINI_API_KEY) throw new Error('مفتاح GEMINI_API_KEY مو معرّف بالكود');

  const parts = [{ text: promptText }];
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: imageMimeType, data: imageBase64 } });
  }

  const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
  let lastError = null;

  for (const model of modelsToTry) {
    try {
      return await callGeminiModelOnce(model, parts, 40000);
    } catch (e) {
      lastError = e;
    }
  }

  console.log('⚠️ كل موديلات Gemini وقعت أو تأخرت:', lastError?.message);
  if (imageBase64) throw lastError || new Error('كل موديلات Gemini فشلت'); // Groq ما بيدعم صور، فما فيه بديل بهالحالة
  console.log('↩️ عم أجرب Groq كبديل...');
  try {
    return await askGroq(promptText);
  } catch (groqError) {
    console.log('⚠️ Groq كمان وقع:', groqError.message);
    // ==== نرمي أوضح خطأ ممكن (سبب Gemini الأصلي هو الأهم للمستخدم) بدل ما نخفيه وراء خطأ Groq ====
    throw lastError || groqError;
  }
}

// ==== 🔎 بحث سريع بالنت (DuckDuckGo Instant Answer — مجاني وبدون مفتاح API) ====
// بيرجع خلاصة قصيرة إذا لقى معلومة مباشرة (تعريف، حقيقة، شخصية معروفة...)، وبيرجع نص فاضي لو ما لقى شي واضح
async function webSearchSummary(query) {
  const res = await fetchWithTimeout(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
    {},
    15000
  );
  const data = await res.json();
  const pieces = [];
  if (data.AbstractText) pieces.push(data.AbstractText);
  if (data.Answer) pieces.push(data.Answer);
  if (data.Definition) pieces.push(data.Definition);
  if (Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics.slice(0, 4)) {
      if (topic.Text) pieces.push(topic.Text);
      else if (Array.isArray(topic.Topics)) {
        for (const sub of topic.Topics.slice(0, 2)) {
          if (sub.Text) pieces.push(sub.Text);
        }
      }
    }
  }
  return pieces.join('\n');
}

// ==== 🎙️ إرسال ملاحظة صوتية لـ Gemini يفهمها ويرد نصياً (فهم صوت + رد بمرة وحدة) ====
async function askGeminiAudio(audioBase64, audioMimeType = 'audio/ogg; codecs=opus') {
  if (!GEMINI_API_KEY) throw new Error('مفتاح GEMINI_API_KEY مو معرّف بالكود');

  // Gemini بيقبل mime types محددة بس، نبسّطها لنوع مدعوم
  const simplifiedMime = audioMimeType.includes('ogg') ? 'audio/ogg' : audioMimeType.split(';')[0];

  const parts = [
    { text: 'استمع لهاد المقطع الصوتي ورد على اللي قاله المتكلم بالعربي، بشكل طبيعي ومختصر.' },
    { inline_data: { mime_type: simplifiedMime, data: audioBase64 } },
  ];

  // ==== نجرب أكتر من موديل بالترتيب لحتى نلاقي وحدة بتدعم فهم الصوت فعلياً وما توقف الأمر ====
  // (كل موديل فيه إعادة محاولة تلقائية مرة وحدة لو صار خطأ اتصال، عبر callGeminiModelOnce)
  const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
  let lastError = null;

  for (const model of modelsToTry) {
    try {
      return await callGeminiModelOnce(model, parts, 45000);
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error('كل الموديلات فشلت بفهم الصوت');
}

// ==== 🎙️ كل الأصوات المتاحة لأمر .نطق — المستخدم يختار أي صوت يحلولو بمعرّف بسيط قدام الأمر ====
// كل صوت معرّف بـ id تبع edge-tts (Microsoft Neural)، واسم عرض، وإيموجي، وجنس (للترتيب بالقائمة)
const TTS_VOICES = {
  'سعودي':    { id: 'ar-SA-HamedNeural',   label: '🧔 رجالي سعودي فصيح',  gender: 'm' },
  'سعوديه':   { id: 'ar-SA-ZariyahNeural', label: '👩 نسائي سعودي',       gender: 'f' },
  'مصري':     { id: 'ar-EG-ShakirNeural',  label: '🧔 رجالي مصري',        gender: 'm' },
  'مصريه':    { id: 'ar-EG-SalmaNeural',   label: '👩 نسائي مصري',        gender: 'f' },
  'شامي':     { id: 'ar-SY-LaithNeural',   label: '🧔 رجالي شامي',        gender: 'm' },
  'شاميه':    { id: 'ar-SY-AmanyNeural',   label: '👩 نسائي شامي',        gender: 'f' },
  'جزائري':   { id: 'ar-DZ-IsmaelNeural',  label: '🧔 رجالي جزائري',      gender: 'm' },
  'جزائريه':  { id: 'ar-DZ-AminaNeural',   label: '👩 نسائي جزائري',      gender: 'f' },
  'اماراتي':  { id: 'ar-AE-HamdanNeural',  label: '🧔 رجالي إماراتي',     gender: 'm' },
  'اماراتيه': { id: 'ar-AE-FatimaNeural',  label: '👩 نسائي إماراتي',     gender: 'f' },
  'كويتي':    { id: 'ar-KW-FahedNeural',   label: '🧔 رجالي كويتي',       gender: 'm' },
  'كويتيه':   { id: 'ar-KW-NouraNeural',   label: '👩 نسائي كويتي',       gender: 'f' },
  'مغربي':    { id: 'ar-MA-JamalNeural',   label: '🧔 رجالي مغربي',       gender: 'm' },
  'مغربيه':   { id: 'ar-MA-MounaNeural',   label: '👩 نسائي مغربي',       gender: 'f' },
  'انجليزي':  { id: 'en-US-GuyNeural',     label: '🌍 رجالي إنجليزي',     gender: 'm' },
  'انجليزيه': { id: 'en-US-JennyNeural',   label: '🌍 نسائي إنجليزي',     gender: 'f' },
};
const DEFAULT_TTS_VOICE_KEY = 'سعودي'; // الصوت الافتراضي لو المستخدم ما اختارش

// ==== 🔊 تحويل نص لملف صوتي باستخدام edge-tts (مجاني، بدون مفتاح API) — بيقبل اختيار الصوت (voiceKey من TTS_VOICES) ====
async function textToSpeechFile(text, voiceKey = DEFAULT_TTS_VOICE_KEY) {
  const safeName = `tts_${Date.now()}`;
  const mp3Path = `/data/data/com.termux/files/home/mybot/${safeName}.mp3`;
  const oggPath = `/data/data/com.termux/files/home/mybot/${safeName}.ogg`;
  const cleanText = text.replace(/"/g, "'").replace(/\n+/g, '. ').slice(0, 500);
  const voiceId = (TTS_VOICES[voiceKey] || TTS_VOICES[DEFAULT_TTS_VOICE_KEY]).id;

  try {
    // ==== الخطوة 1: توليد الصوت بصيغة mp3 عن طريق edge-tts، بالصوت المختار، بسرعة أبطأ شوي ووضوح أعلى ====
    await execPromise(
      `edge-tts --voice ${voiceId} --rate="-8%" --volume="+0%" --pitch="+0Hz" --text "${cleanText}" --write-media "${mp3Path}"`,
      { timeout: 30000 }
    );
    if (!fs.existsSync(mp3Path)) return null;

    // ==== الخطوة 2: تحويلها لـ OGG/Opus، الصيغة اللي واتساب فعلياً بيحتاجها للملاحظات الصوتية ====
    // 🎧 رفعنا الجودة (48k → 64k) وأضفنا فلاتر صوت (تنقية ترددات واطية + توحيد مستوى الصوت) حتى يطلع الصوت أوضح وأنقى
    await execPromise(
      `ffmpeg -y -i "${mp3Path}" -af "highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11" -c:a libopus -b:a 64k -ar 48000 -ac 1 "${oggPath}"`,
      { timeout: 30000 }
    );

    try {
      fs.unlinkSync(mp3Path); // نحذف نسخة الـ mp3 الوسيطة، ما عاد محتاجينها
    } catch (e) {}

    if (fs.existsSync(oggPath)) return oggPath;
    return null;
  } catch (e) {
    console.log('⚠️ edge-tts أو التحويل فشل:', e.message);
    return null;
  }
}

// دالة تقارن الأرقام برقم الهاتف بس، بغض النظر عن @s.whatsapp.net أو @lid
function isBotOwner(jid) {
  if (!jid) return false;
  const number = resolveOwnerNumber(jid);
  return ADMINS.some((admin) => admin.split('@')[0] === number);
}

// ==== 🎞️ فك الستيكر المتحرك (WebP Animation) وتحويله فيديو mp4 ====
// ffmpeg المثبت عندنا ما مبني مع libwebp (شفنا هيك بلوق الأخطاء: "skipping unsupported chunk: ANIM/ANMF")
// يعني ما بيقدر يفك ستيكر متحرك مباشرة. الحل: نستخدم أدوات libwebp (webpmux + dwebp) لنطلع كل فريم لحاله كـ PNG،
// وبعدين نجمعهم بفيديو عن طريق ffmpeg (فك التشفير هون على libwebp الحقيقية، مش على ffmpeg).
async function convertAnimatedWebpToMp4(inputWebpPath, outputMp4Path) {
  const frameDir = `${inputWebpPath}_frames_${Date.now()}`;
  try {
    await execPromise(`mkdir -p "${frameDir}"`);

    // ==== نستخرج كل فريم من الستيكر المتحرك (webpmux) ونفك تشفيره لصورة PNG (dwebp) ====
    const extractCmd =
      `N=$(webpmux -info "${inputWebpPath}" | grep -oE "Number of frames: [0-9]+" | grep -oE "[0-9]+"); ` +
      `if [ -z "$N" ]; then echo "NOFRAMES"; exit 1; fi; ` +
      `for i in $(seq 1 $N); do ` +
      `webpmux -get frame $i "${inputWebpPath}" -o "${frameDir}/f_$i.webp" 2>/dev/null && ` +
      `dwebp "${frameDir}/f_$i.webp" -o "${frameDir}/f_$i.png" 2>/dev/null; ` +
      `done`;
    await execPromise(extractCmd, { timeout: 60000 });

    const frameCountCheck = await execPromise(`ls "${frameDir}"/*.png 2>/dev/null | wc -l`);
    const frameCount = parseInt(String(frameCountCheck.stdout || '0').trim(), 10) || 0;
    if (frameCount === 0) {
      throw new Error(
        'ما قدرت أفك تشفير الستيكر المتحرك. تأكد إن أدوات libwebp متثبتة على السيرفر (Termux: pkg install libwebp).'
      );
    }

    // ==== نجمع الفريمات بفيديو mp4 مربع 512×512 ====
    await execPromise(
      `ffmpeg -y -framerate 15 -i "${frameDir}/f_%d.png" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p" -movflags faststart -pix_fmt yuv420p "${outputMp4Path}"`,
      { timeout: 60000 }
    );

    if (!fs.existsSync(outputMp4Path)) {
      throw new Error('ما طلع فيديو نهائي بعد تجميع الفريمات.');
    }
  } finally {
    try {
      await execPromise(`rm -rf "${frameDir}"`);
    } catch (e) {}
  }
}

// ==== 🔎 دالة عامة تحل معرّف @lid لأي عضو بالقروب (مش بس الأدمن) لرقم هاتفه الحقيقي ====
// تستخدم لما نحتاج نتعامل مع نقاط/رصيد شخص تم منشنه، حتى ما تروح نقاطه لمفتاح غلط (رقم لِد داخلي)
async function resolveGroupMemberNumber(sock, groupId, jid) {
  if (!jid) return jid;
  if (jid.endsWith('@s.whatsapp.net')) return jid.split('@')[0];
  const mapped = resolveOwnerNumber(jid);
  if (mapped && mapped !== jid.split('@')[0]) return mapped; // لقيناه بـ ADMIN_LID_MAP

  if (groupId) {
    try {
      const groupMeta = await sock.groupMetadata(groupId);
      const participant = groupMeta.participants.find((p) => p.id === jid || p.lid === jid);
      if (participant) {
        if (participant.phoneNumber) return participant.phoneNumber.split('@')[0];
        const pNumberResolved = resolveOwnerNumber(participant.id);
        if (pNumberResolved) return pNumberResolved;
      }
    } catch (e) {
      console.log('⚠️ ما قدرت أحل رقم العضو الحقيقي من بيانات القروب:', e.message);
    }
  }
  return jid.split('@')[0]; // ما لقينا بديل، نرجع نفس اللي كان يصير سابقاً
}

// دالة تتأكد هل الشخص أدمن بالقروب (أو مالك البوت)
async function isAdminOrOwner(sock, groupId, sender) {
  if (isBotOwner(sender)) return true;
  try {
    const groupMeta = await sock.groupMetadata(groupId);
    const senderNumber = resolveOwnerNumber(sender); // رقم الهاتف الحقيقي، حتى لو الجيد جاي بصيغة @lid
    // واتساب صار يرجّع participant.id بصيغة @lid بمعظم القروبات (خصوصاً الكبيرة/القديمة)،
    // فما عاد نقدر نعتمد بس على مقارنة الأرقام المباشرة. نجرب كل الطرق الممكنة:
    const participant = groupMeta.participants.find((p) => {
      const pNumberFromPhoneField = p.phoneNumber ? p.phoneNumber.split('@')[0] : null; // حقل رقم الهاتف لو موجود
      const pNumberResolved = resolveOwnerNumber(p.id); // بيفحص ADMIN_LID_MAP لو الـ id معروف عنا
      return (
        pNumberFromPhoneField === senderNumber ||
        pNumberResolved === senderNumber ||
        p.id === sender ||
        p.lid === sender
      );
    });
    return participant?.admin === 'admin' || participant?.admin === 'superadmin';
  } catch (e) {
    console.log('⚠️ خطأ بفحص صلاحيات الأدمن:', e.message);
    return false;
  }
}

// ==== ملفات حفظ البيانات (تضل محفوظة حتى لو أعدت تشغيل البوت) ====
const BANNED_FILE = '/data/data/com.termux/files/home/mybot/banned.json';
const PRAYER_FILE = '/data/data/com.termux/files/home/mybot/prayers.json';
const SALAWAT_FILE = '/data/data/com.termux/files/home/mybot/salawat.json';
const AZKAR_FILE = '/data/data/com.termux/files/home/mybot/azkar.json';
const WARN_FILE = '/data/data/com.termux/files/home/mybot/warnings.json';
const PROTECTION_FILE = '/data/data/com.termux/files/home/mybot/protection.json';
const GROUP_STATS_FILE = '/data/data/com.termux/files/home/mybot/groupstats.json';
const POINTS_FILE = '/data/data/com.termux/files/home/mybot/points.json';
const SHOP_FILE = '/data/data/com.termux/files/home/mybot/shop.json';
const AUCTION_FILE = '/data/data/com.termux/files/home/mybot/auctions.json';
const USAGE_FILE = '/data/data/com.termux/files/home/mybot/usage.json';
const SETTINGS_FILE = '/data/data/com.termux/files/home/mybot/settings.json';
const REMINDERS_FILE = '/data/data/com.termux/files/home/mybot/reminders.json';
const BACKUP_DIR = '/data/data/com.termux/files/home/mybot/backups';
const MUTES_FILE = '/data/data/com.termux/files/home/mybot/mutes.json';
const SLOWMODE_FILE = '/data/data/com.termux/files/home/mybot/slowmode.json';
const JOBS_FILE = '/data/data/com.termux/files/home/mybot/jobs.json';
const DAILY_REWARD_FILE = '/data/data/com.termux/files/home/mybot/daily_reward.json';
const STATS_FILE = '/data/data/com.termux/files/home/mybot/stats.json';
const MARRIAGE_FILE = '/data/data/com.termux/files/home/mybot/marriages.json';
const WEEKLY_FILE = '/data/data/com.termux/files/home/mybot/weekly.json';
const AI_USAGE_FILE = '/data/data/com.termux/files/home/mybot/ai_usage.json';

function loadJSON(path, fallback) {
  try {
    if (fs.existsSync(path)) {
      return JSON.parse(fs.readFileSync(path, 'utf8'));
    }
  } catch (e) {
    console.log('⚠️ خطأ بقراءة ملف:', path, e.message);
  }
  return fallback;
}

function saveJSON(path, data) {
  try {
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (e) {
    console.log('⚠️ خطأ بحفظ ملف:', path, e.message);
  }
}

let banned = loadJSON(BANNED_FILE, []); // مصفوفة أرقام محظورة
let prayerTimes = loadJSON(PRAYER_FILE, {}); // { groupId: { "الفجر": "05:00", ... } }
let salawatGroups = loadJSON(SALAWAT_FILE, []); // مصفوفة أرقام القروبات المفعّلة
let azkarGroups = loadJSON(AZKAR_FILE, []); // مصفوفة أرقام القروبات المفعّلة للأذكار العامة
let warnings = loadJSON(WARN_FILE, {}); // { groupId: { userId: count } }
let botEnabled = true; // حالة تشغيل/إيقاف البوت (تتحكم فيها من واتساب مباشرة)
let protectionSettings = loadJSON(PROTECTION_FILE, {}); // { groupId: { links: true, words: true, flood: false, antidelete: false } }
let groupStats = loadJSON(GROUP_STATS_FILE, {}); // { groupId: { messages: 0 } }
const botStartTime = Date.now(); // لحساب مدة تشغيل البوت (uptime)
const floodTracker = {}; // { chatId: { userId: [timestamps] } } — لكشف السبام (رسائل متكررة بسرعة)
const repeatTracker = {}; // { chatId: { userId: [{t, text}] } } — لكشف نفس الرسالة مكررة (سبام بطيء)
let points = loadJSON(POINTS_FILE, {}); // { userId: number } — نقاط كل شخص بواتساب (رقمه مفتاح ثابت بغض النظر عن القروب)
// ==== 🏆 لوحة الصدارة الأسبوعية: نقاط الأسبوع الحالي بس (بتتصفّر كل أحد) + أرشيف أفضل 3 من كل أسبوع سابق ====
let weeklyLeaderboard = loadJSON(WEEKLY_FILE, { weekStart: null, points: {}, archive: [] });
function saveWeekly() { saveJSON(WEEKLY_FILE, weeklyLeaderboard); }
let shop = loadJSON(SHOP_FILE, {}); // { userId: { title, badges: [], activeBadge, doubleUntil } } — مشتريات متجر النقاط
let auctions = loadJSON(AUCTION_FILE, {}); // { groupId: { itemId, currentBid, currentBidderKey, endsAt, startedBy } } — مزادات المتجر
function saveAuctions() { saveJSON(AUCTION_FILE, auctions); }
let lastPrayerTrigger = {}; // لمنع تكرار نفس التذكير أكتر من مرة بنفس اليوم
let duels = {}; // { groupId: { p1, p2, hp, gold, turn, ... } } — حالة مبارزات .بارز النشطة بالذاكرة (مؤقتة، مش لازم تتخزن بملف)
let prayerSchedulerStarted = false;
let salawatSchedulerStarted = false;
let azkarSchedulerStarted = false;
let auctionSchedulerStarted = false;
let warSchedulerStarted = false;
let backupSchedulerStarted = false;

// ==== 🔇 كتم مؤقت لعضو محدد بالقروب (رسائله تنحذف تلقائياً لحد ما تنتهي المدة) ====
let mutedUsers = loadJSON(MUTES_FILE, {}); // { groupId: { userId: expiresAtTimestamp } }
function saveMutes() { saveJSON(MUTES_FILE, mutedUsers); }

// ==== 🐢 الوضع البطيء: مهلة إجبارية بين كل رسالة والتانية لنفس الشخص بالقروب ====
let slowMode = loadJSON(SLOWMODE_FILE, {}); // { groupId: secondsBetweenMessages }
function saveSlowMode() { saveJSON(SLOWMODE_FILE, slowMode); }
const lastMessageTime = {}; // { groupId: { userId: timestamp } } — بالذاكرة بس، ما يحتاج حفظ دائم

// ==== 🐌 حماية النظام من سبام الأوامر: مهلة صغيرة بين كل أمر والتاني لنفس الشخص (يمنع تعليق البوت من ضغط أوامر ثقيلة زي .اسأل أو .حلل_صورة) ====
const COMMAND_COOLDOWN_MS = 1200;
const lastCommandTime = {}; // { userId: timestamp } — بالذاكرة بس

// ==== 🤖 حماية كوتا الذكاء الاصطناعي (Gemini/Groq): حد يومي، حتى ما يقدر شخص واحد يستنزف الكوتا المدفوعة لحاله ====
// (التبريد بين كل سؤال والتاني موجود أصلاً بمتغير AI_COOLDOWN_MS/checkAiCooldown، هون بس الحد اليومي)
const DAILY_AI_LIMIT_REGULAR = 40; // حد يومي للمستخدم العادي
const DAILY_AI_LIMIT_VIP = 120; // حد يومي أعلى لأعضاء البريميوم (مكافأة اشتراكهم)
const heavyAiCommands = new Set([
  '.اسأل', '.ai', '.كلود', '.بحث_ذكي', '.حلل_صورة', '.تحليل_صورة',
  '.تحدث', '.رد_صوتي', '.نطق', '.صوت', '.ترجم', '.لخص', '.صحح',
  '.اكتب_كود', '.كود', '.حلل_ملف',
]);
let aiUsage = loadJSON(AI_USAGE_FILE, {}); // { userId: { date: 'yyyy-mm-dd', count } }
function saveAiUsage() { saveJSON(AI_USAGE_FILE, aiUsage); }

// ==== يفحص إذا لسا فاضيلو كوتا AI اليوم، وبيزيد العداد لو مسموح. بيرجع { allowed, remaining, limit } ====
function checkAndTrackAiQuota(sender) {
  if (isBotOwner(sender)) return { allowed: true, remaining: Infinity, limit: Infinity };

  const key = pointsKey(sender);
  const today = new Date().toISOString().slice(0, 10);
  const entry = getShopEntry(sender);
  const limit = isPremiumActive(entry) ? DAILY_AI_LIMIT_VIP : DAILY_AI_LIMIT_REGULAR;

  if (!aiUsage[key] || aiUsage[key].date !== today) {
    aiUsage[key] = { date: today, count: 0 };
  }

  if (aiUsage[key].count >= limit) {
    return { allowed: false, remaining: 0, limit };
  }

  aiUsage[key].count += 1;
  saveAiUsage();
  return { allowed: true, remaining: limit - aiUsage[key].count, limit };
}

// ==== 🧹 تنظيف دوري لكل الذاكرة المؤقتة (Trackers) — تمنع تراكم بيانات مستخدمين قدام مع الوقت وتاكل الرام ====
function cleanupMemoryTrackers() {
  const now = Date.now();
  let removed = 0;

  // ---- floodTracker: بيمسح كل توقيت أقدم من 10 ثواني، وبيشيل أي مستخدم/قروب صار فاضي ----
  for (const chatId of Object.keys(floodTracker)) {
    for (const userId of Object.keys(floodTracker[chatId])) {
      floodTracker[chatId][userId] = floodTracker[chatId][userId].filter((t) => now - t < 10000);
      if (floodTracker[chatId][userId].length === 0) {
        delete floodTracker[chatId][userId];
        removed++;
      }
    }
    if (Object.keys(floodTracker[chatId]).length === 0) delete floodTracker[chatId];
  }

  // ---- repeatTracker: بيمسح كل رسالة أقدم من 20 ثانية ----
  for (const chatId of Object.keys(repeatTracker)) {
    for (const userId of Object.keys(repeatTracker[chatId])) {
      repeatTracker[chatId][userId] = repeatTracker[chatId][userId].filter((e) => now - e.t < 20000);
      if (repeatTracker[chatId][userId].length === 0) {
        delete repeatTracker[chatId][userId];
        removed++;
      }
    }
    if (Object.keys(repeatTracker[chatId]).length === 0) delete repeatTracker[chatId];
  }

  // ---- lastMessageTime: بيشيل أي توقيت أقدم من ساعة (ما عاد إله فايدة للوضع البطيء) ----
  for (const groupId of Object.keys(lastMessageTime)) {
    for (const userId of Object.keys(lastMessageTime[groupId])) {
      if (now - lastMessageTime[groupId][userId] > 60 * 60 * 1000) {
        delete lastMessageTime[groupId][userId];
        removed++;
      }
    }
    if (Object.keys(lastMessageTime[groupId]).length === 0) delete lastMessageTime[groupId];
  }

  // ---- lastCommandTime: بيشيل أي توقيت أقدم من دقيقة ----
  for (const userId of Object.keys(lastCommandTime)) {
    if (now - lastCommandTime[userId] > 60 * 1000) {
      delete lastCommandTime[userId];
      removed++;
    }
  }

  if (removed > 0) {
    console.log(`🧹 تنظيف الذاكرة المؤقتة: تم تحرير ${removed} مدخلة قديمة.`);
  }
}
let memoryCleanupSchedulerStarted = false;
let dailyHealthSchedulerStarted = false;

// ==== 🩺 تقرير صحة يومي تلقائي — يبعت لصاحب البوت الأول ملخص سريع عن حالة البوت بدون ما يحتاج يكتب .فحص_النظام يدوياً ====
async function sendDailyHealthReport(sock) {
  const uptimeHours = (process.uptime() / 3600).toFixed(1);
  const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const totalGroups = Object.keys(groupStats).length;
  const totalPlayers = Object.keys(points).length;
  const totalCommandsUsed = Object.values(commandUsage).reduce((a, b) => a + b, 0);
  const connected = !!sock.user;

  let saveOk = true;
  try {
    saveJSON(POINTS_FILE, points);
  } catch (e) {
    saveOk = false;
  }

  await sock.sendMessage(ADMINS[0], {
    text: buildFancyCard(
      '🩺',
      'تقرير الصحة اليومي',
      `${connected ? '✅' : '❌'} الاتصال بواتساب\n` +
        `${saveOk ? '✅' : '❌'} حفظ ملفات البيانات\n\n` +
        `⏱️ مدة التشغيل: ${uptimeHours} ساعة\n` +
        `💾 استهلاك الذاكرة: ${memMB} ميغابايت\n` +
        `👥 عدد القروبات المتصلة: ${totalGroups}\n` +
        `🏅 عدد اللاعبين المسجّلين: ${totalPlayers}\n` +
        `📊 مجموع الأوامر المستخدمة (منذ آخر تشغيل): ${totalCommandsUsed}`,
      '📋 لتقرير أشمل (فحص الصور/أدمنية البوت) اكتب .فحص_النظام'
    ),
  });
}

// ==== 💼 نظام الوظائف والاستثمار (اقتصاد إضافي فوق نظام النقاط) ====
let jobsData = loadJSON(JOBS_FILE, {}); // { userKey: { job: 'اسم', lastWork: timestamp, lastInvest: timestamp } }

// ==== 🎁 الهدية اليومية: نقاط مجانية كل يوم + مكافأة streak كل ما تجي أيام متتالية بلا انقطاع ====
let dailyRewardData = loadJSON(DAILY_REWARD_FILE, {}); // { userKey: { lastClaim: 'yyyy-mm-dd', streak: number } }
function saveDailyReward() { saveJSON(DAILY_REWARD_FILE, dailyRewardData); }

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ==== يحاول يصرف الهدية اليومية لشخص، بيرجع { ok, base, streakBonus, total, streak, alreadyClaimed } ====
function claimDailyReward(jid) {
  const key = pointsKey(jid);
  const today = todayKey();
  const entry = dailyRewardData[key] || { lastClaim: null, streak: 0 };

  if (entry.lastClaim === today) {
    return { ok: false, alreadyClaimed: true, streak: entry.streak };
  }

  // لو آخر مرة كانت بالضبط بارح، الـ streak بتكمل وتزيد. غير هيك (فاتت يوم أو أكتر)، بترجع تبلش من 1.
  entry.streak = entry.lastClaim === yesterdayKey() ? entry.streak + 1 : 1;
  entry.lastClaim = today;
  dailyRewardData[key] = entry;
  saveDailyReward();

  const base = 15 + Math.floor(Math.random() * 16); // 15-30 نقطة عشوائية
  const cappedStreak = Math.min(entry.streak, 7); // البونص بيوقف عند أسبوع كامل (7)، حتى ما يكبر بلا سقف
  const streakBonus = (cappedStreak - 1) * 5; // +5 نقطة عن كل يوم متتالي إضافي، لحد +30 بأسبوع كامل
  const total = base + streakBonus;
  addPoints(jid, total);

  return { ok: true, base, streakBonus, total, streak: entry.streak };
}
function saveJobs() { saveJSON(JOBS_FILE, jobsData); }
function getJobEntry(jid) {
  const key = pointsKey(jid);
  if (!key) return null;
  if (!jobsData[key]) jobsData[key] = { job: null, lastWork: 0, lastInvest: 0 };
  return jobsData[key];
}
const JOB_LIST = [
  { id: 'طبيب', name: '👨‍⚕️ طبيب', min: 20, max: 45 },
  { id: 'مهندس', name: '👷 مهندس', min: 18, max: 40 },
  { id: 'معلم', name: '👨‍🏫 معلم', min: 12, max: 30 },
  { id: 'سائق', name: '🚕 سائق', min: 10, max: 25 },
  { id: 'طباخ', name: '👨‍🍳 طباخ', min: 10, max: 28 },
  { id: 'برمجة', name: '💻 مبرمج', min: 22, max: 50 },
  { id: 'تاجر', name: '🛍️ تاجر', min: 8, max: 35 },
];
const JOB_COOLDOWN_MS = 60 * 60 * 1000; // ساعة واحدة بين كل شغلة والتانية
const INVEST_COOLDOWN_MS = 30 * 60 * 1000; // نص ساعة بين كل استثمار والتاني

// ==== 📈 إحصائيات إضافية لكل شخص (تُستخدم بنظام الإنجازات الموسّع) ====
let userStats = loadJSON(STATS_FILE, {}); // { userKey: { gamesWon, jobsWorked, investWins, mafiaWins, bio } }
function saveStats() { saveJSON(STATS_FILE, userStats); }
function getStatsEntry(jid) {
  const key = pointsKey(jid);
  if (!key) return null;
  if (!userStats[key]) userStats[key] = { gamesWon: 0, jobsWorked: 0, investWins: 0, mafiaWins: 0, bio: null };
  const e = userStats[key];
  if (e.gamesWon === undefined) e.gamesWon = 0;
  if (e.jobsWorked === undefined) e.jobsWorked = 0;
  if (e.investWins === undefined) e.investWins = 0;
  if (e.mafiaWins === undefined) e.mafiaWins = 0;
  if (e.bio === undefined) e.bio = null;
  return e;
}

// ==== 💍 نظام الزواج/الطلاق الافتراضي بين الأعضاء ====
let marriages = loadJSON(MARRIAGE_FILE, {}); // { userKey: { spouse: userKey, since: timestamp } } — مسجّلة بالطرفين
function saveMarriages() { saveJSON(MARRIAGE_FILE, marriages); }
const pendingProposals = {}; // { targetKey: { fromJid, fromKey, expiresAt } } — بالذاكرة فقط، مؤقتة
const PROPOSAL_TIMEOUT_MS = 60 * 1000;

function getSpouseKey(jid) {
  const key = pointsKey(jid);
  return key && marriages[key] ? marriages[key].spouse : null;
}

// ==== 🦠 نظام "أغراض أمونس" الأسطورية: قوى خاصة تُشترى بمتجر المافيا وتُستهلك تلقائياً أثناء اللعب.
// بترجع true لو نجحت تستهلك غرض (يعني كان عند اللاعب واحدة ع الأقل)، و false لو ما عندوش ====
function consumeMafiaPerk(jid, perkKey) {
  const entry = getShopEntry(jid);
  if (!entry || !entry.mafiaPerks || !entry.mafiaPerks[perkKey]) return false;
  entry.mafiaPerks[perkKey] -= 1;
  saveShop();
  return true;
}

// ==== 🕵️ لعبة المافيا (بالذاكرة فقط، تنتهي مع إعادة تشغيل البوت) ====
const mafiaGames = {}; // { groupId: { phase, players:[{jid,role,alive}], joinDeadline, votes:{}, nightActions:{} } }

// بيرجع رقم القروب/المحادثة يلي فيها لعبة مافيا نشيطة والشخص هاد لاعب فيها بمرحلة ليلية (يستخدم لتوجيه أوامر الخاص زي .قتل)
function findActiveMafiaByDM(senderKey) {
  for (const groupId of Object.keys(mafiaGames)) {
    const game = mafiaGames[groupId];
    if (game && game.phase === 'night') {
      const player = game.players.find((p) => pointsKey(p.jid) === senderKey && p.alive);
      if (player) return { groupId, game, player };
    }
  }
  return null;
}

function mafiaAliveList(game) {
  return game.players.filter((p) => p.alive);
}

function mafiaNumberedList(game) {
  return mafiaAliveList(game)
    .map((p, i) => `${i + 1}. @${p.jid.split('@')[0]}`)
    .join('\n');
}

// بتبدأ توزيع الأدوار وأول ليلة، بعد ما يخلص وقت الانضمام
// ==== ⏰ تطوير: تذكير نص الوقت — بينبّه بس اللاعبين اللي لسا ما تصرفوا (ما صوّتوا أو ما بعتوا قرارهم الليلي)
// حتى محدا يفوته دوره بسبب النسيان (بلعب المافيا الجماعية بس، ما في داعي لها بالفردية لأنو الآليين بيتصرفوا فوراً) ====
function scheduleMafiaHalfwayReminder(sock, groupId, phase, durationMs) {
  setTimeout(async () => {
    const game = mafiaGames[groupId];
    if (!game || game.phase !== phase || game.solo) return; // ==== المرحلة خلصت أو اتغيرت أو صارت فردية، ما في داعي ====

    if (phase === 'day') {
      const pending = mafiaAliveList(game).filter((p) => !p.isNpc && !game.votes[p.jid]);
      if (pending.length === 0) return;
      await sock.sendMessage(groupId, {
        text: `⏰ ✦ *تذكير: نص الوقت راح!* ✦\nلسا ما صوّت: ${pending.map((p) => `@${p.jid.split('@')[0]}`).join(', ')}`,
        mentions: pending.map((p) => p.jid),
      });
    } else if (phase === 'night') {
      // ==== الأدوار يلي عندها إجراء "لازم" كل ليلة (القناص مستثنى لأنو استخدامه اختياري بأي ليلة يحب) ====
      const requiredActionByRole = {
        'مافيا': !!game.nightActions.killTarget,
        'طبيب': !!game.nightActions.saveTarget,
        'محقق': !!game.nightActions.checkTarget,
        'تاجر بشر': !!game.nightActions.traffickerTarget,
      };
      const pending = mafiaAliveList(game).filter(
        (p) => !p.isNpc && Object.prototype.hasOwnProperty.call(requiredActionByRole, p.role) && !requiredActionByRole[p.role]
      );
      for (const p of pending) {
        try {
          await sock.sendMessage(p.jid, { text: `⏰ تذكير: نص الوقت راح ولسا ما بعتّ قرارك الليلي! لا تفوّت دورك 👀` });
        } catch (e) {}
      }
    }
  }, Math.floor(durationMs / 2));
}

async function startMafiaNight(sock, groupId) {
  const game = mafiaGames[groupId];
  if (!game || game.phase !== 'lobby') return;

  if (game.players.length < 4) {
    delete mafiaGames[groupId];
    await sock.sendMessage(groupId, { text: '❌ ما اكتمل عدد اللاعبين (لازم 4 على الأقل). الغيت اللعبة.' });
    return;
  }

  // ==== توزيع الأدوار: مافيا حسب عدد اللاعبين، وأدوار خاصة إضافية كل ما زاد عدد اللاعبين، والباقي مواطنين ====
  const shuffled = [...game.players].sort(() => Math.random() - 0.5);
  const total = shuffled.length;
  const mafiaCount = Math.max(1, Math.floor(total / 4));

  // ==== الأدوار الخاصة: طبيب ومحقق أساسيين دايماً، وبإضافة قناص/مهرج/عمدة كل ما كبرت المجموعة (حتى تضل اللعبة متوازنة بمجموعة صغيرة) ====
  const specialRoles = ['طبيب', 'محقق'];
  if (total >= 6) specialRoles.push('قناص');
  if (total >= 7) specialRoles.push('مهرج');
  if (total >= 8) specialRoles.push('عمدة');
  if (total >= 9) specialRoles.push('تاجر بشر');

  shuffled.forEach((p, i) => {
    if (i < mafiaCount) {
      p.role = 'مافيا';
    } else if (i - mafiaCount < specialRoles.length) {
      p.role = specialRoles[i - mafiaCount];
    } else {
      p.role = 'مواطن';
    }
    p.alive = true;
    if (p.role === 'قناص') p.sniperUsed = false; // الرصاصة تنستخدم مرة وحدة بكل اللعبة
    if (p.role === 'تاجر بشر') p.trafficked = 0; // عداد عمليات التهريب الناجحة
  });

  const mafiaMembers = shuffled.filter((p) => p.role === 'مافيا').map((p) => `@${p.jid.split('@')[0]}`);

  // ==== 📖 دليل سريع مرفق مع كل دور بالخاص، حتى الكل يعرف يلعب من أول لحظة بلا ما يحتاج يدوّر أو يسأل ====
  const quickGuideFooter =
    `\n\n〰️〰️〰️〰️〰️〰️〰️\n` +
    `📖 *تذكير سريع بقواعد اللعبة:*\n` +
    `🌙 بالليل: أصحاب الأدوار الخاصة يبعتوا قرارهم هون بالخاص (زي فوق) قبل ما ينتهي الوقت.\n` +
    `☀️ بالنهار: بالقروب تناقشوا، وبعدين صوّتوا بـ *.تصويت [رقم]* على مين تشكوا فيه (وفيك تسحب صوتك بـ *.الغاء_تصويت* وتغيّره براحتك لحد ما تنتهي المدة).\n` +
    `🏆 المواطنين يفوزوا لو قضوا على كل أعضاء المافيا. المافيا تفوز لو صار عددهم مساوي أو أكبر من الباقيين. المهرج وتاجر البشر عندهم شروط فوز خاصة فردية (مشروحة فوق لو دورك أحدهم).\n` +
    `🦠 عندك أغراض أسطورية من *.متجر_المافيا* (درع، بعث، تمويه...)؟ رح تشتغل تلقائياً وقت اللزوم بدون ما تعمل أي شي.\n` +
    `📋 لأي تفاصيل زيادة أو نسيت شي، اكتب *.مساعدة_مافيا* بأي وقت خلال اللعبة.`;

  for (const p of shuffled) {
    let roleText = '';
    if (p.role === 'مافيا') {
      roleText =
        `🔪 ✦ *أنت مافيا!* ✦\n\n` +
        `زملاؤك بالمافيا: ${mafiaMembers.join(', ') || 'وحيد'}\n\n` +
        `كل ليلة ابعتلي هون بالخاص: *.قتل [رقم]* حسب الترقيم يلي رح يوصلك بالقروب.`;
    } else if (p.role === 'طبيب') {
      roleText = `💊 ✦ *أنت الطبيب!* ✦\n\nكل ليلة ابعتلي هون بالخاص: *.حماية [رقم]* لتحمي شخص من القتل.`;
    } else if (p.role === 'محقق') {
      roleText = `🔍 ✦ *أنت المحقق!* ✦\n\nكل ليلة ابعتلي هون بالخاص: *.تحقيق [رقم]* لتعرف هل هو مافيا أو لأ.`;
    } else if (p.role === 'قناص') {
      roleText =
        `🎯 ✦ *أنت القناص!* ✦\n\n` +
        `عندك رصاصة *وحدة بس بكل اللعبة*. أي ليلة بدك، ابعتلي بالخاص: *.قنص [رقم]* لتصيب حداً تشك فيه.\n\n` +
        `✅ لو صوبت مافيا فعلي، بيموت فوراً!\n` +
        `❌ لو غلطت وصوبت بريء، أنت اللي بتموت بدالو (وخز الضمير)!\n\n` +
        `فكر منيح قبل ما تستخدمها، ما فيك تسحبها بعد ما تبعتها.`;
    } else if (p.role === 'مهرج') {
      roleText =
        `🃏 ✦ *أنت المهرج!* ✦\n\n` +
        `أنت مش مع المافيا ولا مع المواطنين. هدفك الوحيد: *خلّي الناس يصوّتوا عليك ويطردوك بالنهار*.\n\n` +
        `لو نجحت، بتفوز *وحدك* حتى لو خسر الجميع! ما عندك قدرة ليلية، بس فيك تتصرف بشكل مريب قصداً حتى يشكوا فيك 😏`;
    } else if (p.role === 'عمدة') {
      roleText =
        `👑 ✦ *أنت العمدة!* ✦\n\n` +
        `أنت مواطن عادي بقدرة سرية: *صوتك بالتصويت النهاري يساوي صوتين* بدل صوت واحد!\n\n` +
        `محدا بيعرف هالسر — حافظ عليه واستخدمه بذكاء وقت التصويت.`;
    } else if (p.role === 'تاجر بشر') {
      roleText =
        `🕴️ ✦ *أنت تاجر بشر!* ✦\n\n` +
        `أنت وحدك بهالدور، مش مع المافيا ولا مع المواطنين. كل ليلة فيك تهرّب شخص من اللعبة بأمر: *.تهريب [رقم]*.\n\n` +
        `🎯 هدفك: تهرّب *3 أشخاص* وتضل حي — لو نجحت، بتفوز وحدك بغض النظر عن نتيجة باقي اللعبة!\n\n` +
        `⚠️ خلي بالك: كل ما هرّبت حدا، اللاعبين الأحياء عم يقلّوا، وفرصة إنو حدا يشك فيك ويصوّتلك عم تكبر.`;
    } else {
      roleText = `🙂 ✦ *أنت مواطن عادي!* ✦\n\nمهمتك تكتشف مين المافيا بالنهار وتصوّت لطرده. مافي عندك قدرة ليلية.`;
    }
    try {
      await sock.sendMessage(p.jid, { text: roleText + quickGuideFooter });
    } catch (e) {
      console.log('⚠️ ما قدرت أبعت دور المافيا لـ', p.jid, e.message);
    }
  }

  game.phase = 'night';
  game.nightActions = {};
  autoFillSoloNightActions(game); // ==== 🤖 بوضع اللعب الفردي، اللاعبين الآليين ياخدوا قرارهم الليلي فوراً ====
  await sock.sendMessage(groupId, {
    text:
      `🌙 ✦ *بدأت الليلة الأولى* ✦\n\n` +
      `عدد اللاعبين: ${shuffled.length} (منهم ${mafiaCount} مافيا 🔪)\n\n` +
      `أصحاب الأدوار الخاصة وصلهم دورهم بالخاص. عندكم ${game.solo ? '25' : '60'} ثانية للتحرك بالخاص، الباقي استنوا بصمت 🤫\n\n` +
      `${mafiaNumberedList(game)}`,
  });

  if (game.solo && !soloHumanHasNightAction(game)) {
    await resolveMafiaNight(sock, groupId);
  } else {
    const nightDuration = game.solo ? 25000 : 60000;
    if (!game.solo) scheduleMafiaHalfwayReminder(sock, groupId, 'night', nightDuration);
    setTimeout(() => resolveMafiaNight(sock, groupId), nightDuration);
  }
}

// بتحل نتيجة الليل: مين انقتل (إلا لو الطبيب حماه)، نتيجة رصاصة القناص لو استخدمها، وبتفحص شرط الفوز
async function resolveMafiaNight(sock, groupId) {
  const game = mafiaGames[groupId];
  if (!game || game.phase !== 'night') return;

  const { killTarget, saveTarget, checkTarget, checkerJid, sniperShooterJid, sniperTarget, traffickerJid, traffickerTarget } = game.nightActions || {};
  let resultText = '';

  if (killTarget && killTarget === saveTarget) {
    resultText = `💊 الطبيب نجح إنه ينقذ حدا الليلة! محدا مات 🎉`;
  } else if (killTarget) {
    const victim = game.players.find((p) => p.jid === killTarget);
    if (victim) {
      if (consumeMafiaPerk(victim.jid, 'shield')) {
        resultText = `🛡️ ✦ *درع أمونس نجّى @${victim.jid.split('@')[0]}!* حاولت المافيا تقتله الليلة بس درعه امتص الضربة (استهلك الآن) ✦`;
      } else {
        victim.alive = false;
        if (consumeMafiaPerk(victim.jid, 'revive')) {
          victim.alive = true;
          resultText = `💀✨ ✦ *@${victim.jid.split('@')[0]} انقتل الليلة... بس بعث أمونس الأسطوري رجّعه للحياة فوراً!* ✦ (الغرض استهلك، ما رح يشتغل مرة تانية)`;
        } else {
          resultText = `☠️ ✦ *انقتل الليلة:* @${victim.jid.split('@')[0]} (كان ${victim.role}) ✦`;
        }
      }
    } else {
      resultText = `🌙 المافيا ما قدرت تقرر مين تقتل الليلة، محدا مات.`;
    }
  } else {
    resultText = `🌙 هدوء الليلة، محدا مات (المافيا ما تحركت).`;
  }

  // ==== 🎯 نتيجة رصاصة القناص (لو استخدمها الليلة) ====
  if (sniperShooterJid && sniperTarget) {
    const shooter = game.players.find((p) => p.jid === sniperShooterJid);
    const target = game.players.find((p) => p.jid === sniperTarget);
    if (shooter && target) {
      if (!target.alive) {
        resultText += `\n\n🎯 القناص أطلق رصاصته، بس هدفه كان مات أصلاً الليلة (الرصاصة راحت هدر).`;
      } else if (target.role === 'مافيا') {
        target.alive = false;
        resultText += `\n\n🎯 ✦ *القناص أصاب هدفه!* @${target.jid.split('@')[0]} كان مافيا فعلاً وانقتل فوراً! 🔥`;
      } else if (consumeMafiaPerk(shooter.jid, 'shield')) {
        resultText += `\n\n🎯 ✦ *أخطأ القناص الهدف!* @${target.jid.split('@')[0]} كان بريء... بس درع أمونس حمى @${shooter.jid.split('@')[0]} من عقاب ضميره (الدرع استهلك) 🛡️`;
      } else {
        shooter.alive = false;
        if (consumeMafiaPerk(shooter.jid, 'revive')) {
          shooter.alive = true;
          resultText += `\n\n🎯💀✨ أخطأ القناص الهدف ومات من تأنيب الضمير، بس بعث أمونس الأسطوري رجّع @${shooter.jid.split('@')[0]} للحياة فوراً!`;
        } else {
          resultText += `\n\n🎯 ✦ *أخطأ القناص الهدف!* @${target.jid.split('@')[0]} كان بريء... وضمير القناص ما احتمل، مات @${shooter.jid.split('@')[0]} بدالو 💔`;
        }
      }
    }
  }

  // ==== 🕴️ نتيجة تهريب تاجر البشر (لو استخدمها الليلة) ====
  if (traffickerJid && traffickerTarget) {
    const trafficker = game.players.find((p) => p.jid === traffickerJid);
    const victim = game.players.find((p) => p.jid === traffickerTarget);
    if (trafficker && victim) {
      if (!victim.alive) {
        resultText += `\n\n🕴️ حاول تاجر البشر يهرّب حدا، بس هدفه كان مات أصلاً الليلة (حاول لحظة تانية).`;
      } else if (consumeMafiaPerk(victim.jid, 'shield')) {
        resultText += `\n\n🛡️ حاول تاجر البشر يهرّب @${victim.jid.split('@')[0]} بس درع أمونس منعه بآخر لحظة (الدرع استهلك)!`;
      } else {
        victim.alive = false;
        trafficker.trafficked = (trafficker.trafficked || 0) + 1;
        resultText += `\n\n🕴️ ✦ *تاجر البشر ضرب من تحت الأرض!* @${victim.jid.split('@')[0]} اختفى الليلة وانهرّب... محدا بيعرف مين وراها (عمليات ناجحة: ${trafficker.trafficked}/3) ✦`;
      }
    }
  }

  if (checkTarget && checkerJid) {
    const suspect = game.players.find((p) => p.jid === checkTarget);
    if (suspect) {
      let verdict = suspect.role === 'مافيا' ? '🔴 هو مافيا فعلاً!' : '🟢 مو مافيا.';
      if (suspect.role === 'مافيا' && consumeMafiaPerk(suspect.jid, 'disguise')) {
        verdict = '🟢 مو مافيا.'; // ==== 🎭 قناع أمونس موّه نتيجة التحقيق ====
      }
      try {
        await sock.sendMessage(checkerJid, { text: `🔍 نتيجة تحقيقك عن @${suspect.jid.split('@')[0]}:\n${verdict}` });
      } catch (e) {}
    }
  }

  await sock.sendMessage(groupId, { text: resultText, mentions: game.players.map((p) => p.jid) });

  // ==== 🕴️ تحقق فوز تاجر البشر: لو وصل لـ3 عمليات تهريب ولسا حي، بيفوز وحده فوراً بغض النظر عن باقي اللعبة ====
  const traffickerPlayer = game.players.find((p) => p.role === 'تاجر بشر');
  if (traffickerPlayer && traffickerPlayer.alive && (traffickerPlayer.trafficked || 0) >= 3) {
    await endMafiaGame(sock, groupId, 'تاجر بشر');
    return;
  }

  const winner = checkMafiaWinCondition(game);
  if (winner) {
    await endMafiaGame(sock, groupId, winner);
    return;
  }

  game.phase = 'day';
  game.votes = {};
  autoFillSoloDayVotes(game); // ==== 🤖 بوضع اللعب الفردي، اللاعبين الآليين يصوّتوا فوراً ====
  await sock.sendMessage(groupId, {
    text:
      `☀️ ✦ *صار نهار، وقت النقاش والتصويت!* ✦\n\n` +
      `اللاعبين الأحياء:\n${mafiaNumberedList(game)}\n\n` +
      `🗳️ صوّتوا بـ *.تصويت [رقم]* أو منشن مباشر للاعب.\n` +
      `↩️ *.الغاء_تصويت* لسحب صوتك، وتقدروا تغيّروا صوتكم متل ما بدكم.\n` +
      `⏰ عندكم ${game.solo ? '30' : '90'} ثانية — لو صوّت الكل قبلها، النتيجة بتطلع فوراً.`,
  });

  const aliveNowDay = mafiaAliveList(game).length;
  const votedNowDay = Object.keys(game.votes).length;
  if (game.solo && votedNowDay >= aliveNowDay) {
    await resolveMafiaDay(sock, groupId);
  } else {
    const dayDuration = game.solo ? 30000 : 90000;
    if (!game.solo) scheduleMafiaHalfwayReminder(sock, groupId, 'day', dayDuration);
    setTimeout(() => resolveMafiaDay(sock, groupId), dayDuration);
  }
}

// بتحل نتيجة التصويت النهاري: أكتر شخص انصوتلو بيطلع من اللعبة
async function resolveMafiaDay(sock, groupId) {
  const game = mafiaGames[groupId];
  if (!game || game.phase !== 'day') return;
  game.phase = 'resolving'; // ==== قفل فوري يمنع تنفيذ مزدوج (تايمر الـ90 ثانية + كل اللاعبين صوّتوا بنفس اللحظة) ====

  const tally = {};
  Object.entries(game.votes || {}).forEach(([voterJid, targetJid]) => {
    const voter = game.players.find((p) => p.jid === voterJid);
    let weight = 1;
    if (voter && voter.role === 'عمدة') weight = 2; // ==== صوت العمدة السري يساوي صوتين ====
    else if (voter && consumeMafiaPerk(voter.jid, 'doubleVote')) weight = 2; // ==== 👑 نفوذ أمونس المضاعف (غرض من المتجر) ====
    tally[targetJid] = (tally[targetJid] || 0) + weight;
  });

  const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const breakdown = entries.map(([jid, count]) => `• @${jid.split('@')[0]} — ${count} صوت`).join('\n');
  const notVoted = mafiaAliveList(game).filter((p) => !game.votes[p.jid]);

  let resultText = '';

  if (entries.length === 0) {
    resultText = `🤷 محدا صوّت، محدا طلع من اللعبة اليوم.`;
  } else {
    const [topJid, topVotes] = entries[0];
    const tiedJids = entries.filter(([, v]) => v === topVotes).map(([jid]) => jid);
    if (tiedJids.length > 1) {
      resultText =
        `⚖️ *تعادل بالأصوات* بين ${tiedJids.map((j) => `@${j.split('@')[0]}`).join(' و ')} (${topVotes} صوت لكل واحد)، محدا طلع اليوم.\n\n` +
        `📊 *تفاصيل الأصوات:*\n${breakdown}`;
    } else {
      const eliminated = game.players.find((p) => p.jid === topJid);
      if (eliminated) {
        eliminated.alive = false;
        if (consumeMafiaPerk(eliminated.jid, 'revive')) {
          eliminated.alive = true;
          resultText =
            `🚫💀✨ ✦ *طلع من اللعبة:* @${eliminated.jid.split('@')[0]} (كان ${eliminated.role}) بـ ${topVotes} صوت/أصوات — بس بعث أمونس الأسطوري رجّعه فوراً للحياة! ✦\n\n` +
            `📊 *تفاصيل الأصوات:*\n${breakdown}`;
        } else {
        resultText =
          `🚫 ✦ *طلع من اللعبة:* @${eliminated.jid.split('@')[0]} (كان ${eliminated.role}) بـ ${topVotes} صوت/أصوات ✦\n\n` +
          `📊 *تفاصيل الأصوات:*\n${breakdown}`;

        // ==== 🃏 لو المطرود كان المهرج، بيفوز وحده فوراً بغض النظر عن حالة باقي اللعبة ====
        if (eliminated.role === 'مهرج') {
          if (notVoted.length > 0) {
            resultText += `\n\n😴 ما صوّت: ${notVoted.map((p) => `@${p.jid.split('@')[0]}`).join(', ')}`;
          }
          await sock.sendMessage(groupId, { text: resultText, mentions: game.players.map((p) => p.jid) });
          await sock.sendMessage(groupId, {
            text: `🃏 ✦ *يا خبر! المطرود كان المهرج!* ✦\n\nنجح بخطته وخلّى الكل يصوّت عليه... المهرج بيفوز وحده باللعبة! 🎉`,
            mentions: [eliminated.jid],
          });
          await endMafiaGame(sock, groupId, 'مهرج');
          return;
        }
        }
      }
    }
  }

  if (notVoted.length > 0) {
    resultText += `\n\n😴 ما صوّت: ${notVoted.map((p) => `@${p.jid.split('@')[0]}`).join(', ')}`;
  }

  await sock.sendMessage(groupId, { text: resultText, mentions: game.players.map((p) => p.jid) });

  const winner = checkMafiaWinCondition(game);
  if (winner) {
    await endMafiaGame(sock, groupId, winner);
    return;
  }

  game.phase = 'night';
  game.nightActions = {};
  autoFillSoloNightActions(game); // ==== 🤖 بوضع اللعب الفردي، اللاعبين الآليين ياخدوا قرارهم الليلي فوراً ====
  await sock.sendMessage(groupId, {
    text: `🌙 ✦ *بدأت ليلة جديدة* ✦\n\nأصحاب الأدوار الخاصة تحركوا بالخاص خلال ${game.solo ? '25' : '60'} ثانية.\n\n${mafiaNumberedList(game)}`,
  });
  if (game.solo && !soloHumanHasNightAction(game)) {
    await resolveMafiaNight(sock, groupId);
  } else {
    const nightDuration = game.solo ? 25000 : 60000;
    if (!game.solo) scheduleMafiaHalfwayReminder(sock, groupId, 'night', nightDuration);
    setTimeout(() => resolveMafiaNight(sock, groupId), nightDuration);
  }
}

// بترجع 'مافيا' أو 'مواطنين' لو في فريق حسم اللعبة، أو null لو لسا مستمرة
function checkMafiaWinCondition(game) {
  const alive = mafiaAliveList(game);
  const aliveMafia = alive.filter((p) => p.role === 'مافيا').length;
  const aliveOthers = alive.length - aliveMafia;
  if (aliveMafia === 0) return 'مواطنين';
  if (aliveMafia >= aliveOthers) return 'مافيا';
  return null;
}

async function endMafiaGame(sock, groupId, winner) {
  const game = mafiaGames[groupId];
  if (!game) return;
  const rolesReveal = game.players
    .map((p) => `${p.alive ? '🟢' : '⚫'} @${p.jid.split('@')[0]} — ${p.role}`)
    .join('\n');

  const winningPlayers =
    winner === 'مهرج'
      ? game.players.filter((p) => p.role === 'مهرج')
      : winner === 'تاجر بشر'
      ? game.players.filter((p) => p.role === 'تاجر بشر')
      : game.players.filter((p) => (winner === 'مافيا' ? p.role === 'مافيا' : p.role !== 'مافيا'));
  const bonusPoints = winner === 'مهرج' ? 30 : winner === 'تاجر بشر' ? 35 : 20; // ==== الأدوار الفردية فوزها أصعب فبتاخد بونص أكبر ====
  for (const p of winningPlayers) {
    if (p.isNpc) continue; // ==== اللاعبين الآليين ما يحتاجوا نقاط أو إنجازات ====
    const before = getStatsEntry(p.jid).mafiaWins;
    getStatsEntry(p.jid).mafiaWins = before + 1;
    saveStats();
    await checkStatAchievement(sock, groupId, p.jid, 'mafiaWins', before, before + 1);
    await addPoints(p.jid, bonusPoints);
  }

  const winnerLabel =
    winner === 'مهرج' ? 'المهرج 🃏 (فوز فردي!)' : winner === 'تاجر بشر' ? 'تاجر البشر 🕴️ (فوز فردي!)' : winner;

  await sock.sendMessage(groupId, {
    text:
      `🏁 ✦ *انتهت لعبة المافيا!* ✦\n\n` +
      `🎉 الفريق الفايز: *${winnerLabel}*\n\n` +
      `📋 كشف الأدوار:\n${rolesReveal}\n\n` +
      `🏅 كل فايز حقيقي أخد +${bonusPoints} نقطة`,
    mentions: game.players.filter((p) => !p.isNpc).map((p) => p.jid),
  });

  delete mafiaGames[groupId];
}

// ==== 🤖 لعبة مافيا فردية: يبني هوية لاعب آلي (NPC) بجيد وهمي ما يتصادم مع لاعبين تانيين ====
function makeSoloNpcId(index) {
  const base = Date.now() % 1000000;
  return `9${base}${index}@s.whatsapp.net`;
}

// بترجع true لو في لاعب حقيقي حي (مش آلي) عنده هالدور بالذات — يستخدم حتى منعرف نسيب المجال فاضي لقراره بدل ما نخلي لاعب آلي ياخد القرار بدالو
function soloRoleHeldByHuman(game, role) {
  return game.players.some((p) => !p.isNpc && p.alive && p.role === role);
}

// بتختار هدف عشوائي حي، مع إمكانية استثناء جيدات معينة (متل زملاء المافيا) — تستخدم بقرارات اللاعبين الآليين
function randomAliveTarget(game, excludeJid, extraExcludeJids = []) {
  const pool = mafiaAliveList(game).filter((p) => p.jid !== excludeJid && !extraExcludeJids.includes(p.jid));
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// بترجع true لو في لاعب حقيقي حي واحد ع الأقل عنده دور بقدرة ليلية لازم ينتظرها البوت (بوضع اللعب الفردي)
function soloHumanHasNightAction(game) {
  const actionRoles = ['مافيا', 'طبيب', 'محقق', 'قناص', 'تاجر بشر'];
  return game.players.some((p) => !p.isNpc && p.alive && actionRoles.includes(p.role));
}

// ==== 🤖 بوضع اللعب الفردي: تخلي اللاعبين الآليين ياخدوا قراراتهم الليلية تلقائياً ====
// (لو في لاعب حقيقي حامل نفس الدور، منسيب المجال فاضي وننتظر قراره عن طريق الأوامر العادية)
function autoFillSoloNightActions(game) {
  if (!game.solo) return;

  if (!soloRoleHeldByHuman(game, 'مافيا')) {
    const mafiaNpcs = game.players.filter((p) => p.role === 'مافيا' && p.alive && p.isNpc);
    if (mafiaNpcs.length > 0 && !game.nightActions.killTarget) {
      const mafiaJids = game.players.filter((p) => p.role === 'مافيا').map((p) => p.jid);
      const target = randomAliveTarget(game, null, mafiaJids);
      if (target) game.nightActions.killTarget = target.jid;
    }
  }
  if (!soloRoleHeldByHuman(game, 'طبيب')) {
    const doctorNpc = game.players.find((p) => p.role === 'طبيب' && p.alive && p.isNpc);
    if (doctorNpc) {
      const target = randomAliveTarget(game, null);
      if (target) game.nightActions.saveTarget = target.jid;
    }
  }
  if (!soloRoleHeldByHuman(game, 'محقق')) {
    const detectiveNpc = game.players.find((p) => p.role === 'محقق' && p.alive && p.isNpc);
    if (detectiveNpc) {
      const target = randomAliveTarget(game, detectiveNpc.jid);
      if (target) {
        game.nightActions.checkTarget = target.jid;
        game.nightActions.checkerJid = detectiveNpc.jid;
      }
    }
  }
  if (!soloRoleHeldByHuman(game, 'قناص')) {
    const sniperNpc = game.players.find((p) => p.role === 'قناص' && p.alive && p.isNpc && !p.sniperUsed);
    if (sniperNpc && Math.random() < 0.3) {
      const target = randomAliveTarget(game, sniperNpc.jid);
      if (target) {
        sniperNpc.sniperUsed = true;
        game.nightActions.sniperShooterJid = sniperNpc.jid;
        game.nightActions.sniperTarget = target.jid;
      }
    }
  }
  if (!soloRoleHeldByHuman(game, 'تاجر بشر')) {
    const traffickerNpc = game.players.find((p) => p.role === 'تاجر بشر' && p.alive && p.isNpc);
    if (traffickerNpc) {
      const target = randomAliveTarget(game, traffickerNpc.jid);
      if (target) {
        game.nightActions.traffickerJid = traffickerNpc.jid;
        game.nightActions.traffickerTarget = target.jid;
      }
    }
  }
}

// ==== 🤖 بوضع اللعب الفردي: تخلي اللاعبين الآليين يصوّتوا تلقائياً بمرحلة النهار (المافيا ما بتصوّت على بعضها) ====
function autoFillSoloDayVotes(game) {
  if (!game.solo) return;
  const alive = mafiaAliveList(game);
  for (const p of alive) {
    if (!p.isNpc || game.votes[p.jid]) continue;
    const mafiaJids = p.role === 'مافيا' ? game.players.filter((x) => x.role === 'مافيا').map((x) => x.jid) : [];
    const target = randomAliveTarget(game, p.jid, mafiaJids);
    if (target) game.votes[p.jid] = target.jid;
  }
}

// ==== 🧍 بتقفل باب الانضمام للعبة فردية (بعد فترة الانتظار لو صارت بقروب) وتعبي المقاعد الباقية بلاعبين آليين قبل ما تبلش الليلة الأولى ====
async function finalizeSoloLobby(sock, groupId) {
  const game = mafiaGames[groupId];
  if (!game || game.phase !== 'lobby' || !game.solo) return;

  const humanCount = game.players.length;
  const npcNeeded = Math.max(0, (game.maxPlayers || 6) - humanCount);
  for (let i = 0; i < npcNeeded; i++) {
    game.players.push({ jid: makeSoloNpcId(i), alive: true, isNpc: true });
  }

  await sock.sendMessage(groupId, {
    text:
      humanCount > 1
        ? `👥 ✦ انضم ${humanCount} لاعبين حقيقيين، وتعبى الباقي (${npcNeeded}) بلاعبين آليين 🤖 ✦\n` +
          `المجموع: ${game.players.length} لاعب. يلا نبلش!`
        : `🤖 محدا انضم، فعبينا اللعبة بـ ${npcNeeded} لاعبين آليين. يلا نبلش!`,
    mentions: game.players.filter((p) => !p.isNpc).map((p) => p.jid),
  });

  await startMafiaNight(sock, groupId);
}



// ==== 📊 إحصائيات استخدام الأوامر (لأمر .احصائيات_الاستخدام الخاص بالمطور) ====
let commandUsage = loadJSON(USAGE_FILE, {}); // { '.اسأل': 12, '.سؤال': 5, ... }
function trackCommandUsage(cmd) {
  if (!cmd || !cmd.startsWith('.')) return;
  commandUsage[cmd] = (commandUsage[cmd] || 0) + 1;
  // نحفظ كل 10 استخدامات بس، حتى ما نكتب على الملف بكل رسالة
  const total = Object.values(commandUsage).reduce((a, b) => a + b, 0);
  if (total % 10 === 0) saveJSON(USAGE_FILE, commandUsage);
}

// ==== ⚙️ إعدادات عامة قابلة للتفعيل/التعطيل من واتساب (تُحفظ بملف واحد) ====
let botSettings = loadJSON(SETTINGS_FILE, {
  antiViewOnce: false, // مراقبة رسائل المشاهدة الواحدة (مطفية افتراضياً، الخصوصية أولاً)
  autoBackup: true, // نسخ احتياطي تلقائي يومي لملفات البيانات، يُبعت لصاحب البوت بالخاص
});
function saveBotSettings() {
  saveJSON(SETTINGS_FILE, botSettings);
}

// ==== ⏰ التذكيرات: تُحفظ بملف عشان ما تضيع لو البوت أعاد التشغيل، وتدعم التكرار اليومي ====
// شكل كل تذكير: { id, chatJid, text, dueAt (timestamp), recurring: 'daily' | null, createdBy }
let reminders = loadJSON(REMINDERS_FILE, []);
function saveReminders() {
  saveJSON(REMINDERS_FILE, reminders);
}
let nextReminderId = reminders.length > 0 ? Math.max(...reminders.map((r) => r.id)) + 1 : 1;

// ==== ⏰ تشغل مؤقت واحد فعلي لكل تذكير قائم، وتعيد جدولة التذكيرات المتكررة تلقائياً ====
function scheduleReminder(sock, reminder) {
  const delay = Math.max(0, reminder.dueAt - Date.now());
  setTimeout(async () => {
    try {
      await sock.sendMessage(reminder.chatJid, { text: `⏰ ✦ *تذكير* ✦\n\n${reminder.text}` });
    } catch (e) {
      console.log('⚠️ ما قدرت أبعت التذكير:', e.message);
    }
    if (reminder.recurring === 'daily') {
      // ==== نجدول نفس التذكير بعد 24 ساعة من وقته الأصلي، مو من وقت الإرسال، حتى ما يصير انزياح تراكمي ====
      reminder.dueAt += 24 * 60 * 60 * 1000;
      saveReminders();
      scheduleReminder(sock, reminder);
    } else {
      reminders = reminders.filter((r) => r.id !== reminder.id);
      saveReminders();
    }
  }, delay);
}
// ==== نجدول كل التذكيرات المحفوظة عند بدء تشغيل البوت (حتى اللي كانت قبل إعادة التشغيل) ====
function scheduleAllSavedReminders(sock) {
  for (const reminder of reminders) {
    scheduleReminder(sock, reminder);
  }
}

// ==== ⏱️ تبريد (Cooldown) لأوامر الذكاء الاصطناعي، لمنع استنزاف حصة الـ API من شخص واحد بالسبام ====
const aiCooldownTracker = {}; // { userJid: lastTimestamp }
const AI_COOLDOWN_MS = 8000; // 8 ثواني بين كل سؤال والتاني لنفس الشخص
function checkAiCooldown(jid) {
  const now = Date.now();
  const last = aiCooldownTracker[jid] || 0;
  const remainingMs = AI_COOLDOWN_MS - (now - last);
  if (remainingMs > 0) return Math.ceil(remainingMs / 1000);
  aiCooldownTracker[jid] = now;
  return 0; // مافي تبريد، يقدر يسأل
}

// ==== 🧠 شخصية الذكاء الاصطناعي + ذاكرة محادثة قصيرة لكل مستخدم (تخليه يتذكر آخر كم رسالة بدل ما ينسى كل مرة) ====
const AI_PERSONA =
  `إنت مساعد ذكاء اصطناعي ذكي وودود، جزء من بوت واتساب اسمه ${BOT_PROFILE_NAME}. ` +
  'ردودك بالعربي (لهجة بسيطة ومفهومة، شامية إذا ناسب)، طبيعية ومباشرة بدون حشو أو مقدمات طويلة. ' +
  'كون مختصر بالأسئلة البسيطة، وفصّل أكتر بس لما السؤال فعلاً يحتاج شرح أو خطوات. ' +
  'إذا ما كنت متأكد من معلومة أو تاريخها ممكن يكون تغيّر، قول هيك بصراحة بدل ما تختلق جواب. ' +
  'لو حدا سألك مين إنت، قول إنك مساعد البوت الذكي، بدون ما تدّعي إنك منتج شركة معينة. ' +
  'لو السؤال فيه سياق من رسالة متلها (رد على رسالة)، استخدمه لفهم قصد السائل أحسن.';

const AI_MEMORY_FILE = '/data/data/com.termux/files/home/mybot/aimemory.json';
// الصيغة الجديدة: { userNumber: { summary: 'ملخص للمحادثات القديمة', turns: [{q, a}, ...] } }
// (الصيغة القديمة كانت مصفوفة مباشرة بدون ملخص — فيه تحويل تلقائي بالأسفل لأي بيانات قديمة)
const aiMemory = loadJSON(AI_MEMORY_FILE, {});
const AI_MEMORY_MAX_TURNS = 10; // آخر 10 تبادلات خام لكل شخص، وأي شي أقدم بيتلخص بدل ما يترمى بالكامل
let aiMemorySaveTimer = null;
function saveAiMemoryDebounced() {
  // نأجل الحفظ شوي حتى ما نكتب على القرص بكل رسالة (تحسين أداء لو في ضغط أسئلة)
  clearTimeout(aiMemorySaveTimer);
  aiMemorySaveTimer = setTimeout(() => saveJSON(AI_MEMORY_FILE, aiMemory), 2000);
}

// ==== 🧠 يرجع سجل ذاكرة المستخدم، ويحوّل الصيغة القديمة (مصفوفة بس) للصيغة الجديدة (ملخص + تبادلات) تلقائياً ====
function getAiMemoryEntry(userNumber) {
  const existing = aiMemory[userNumber];
  if (Array.isArray(existing)) {
    aiMemory[userNumber] = { summary: '', turns: existing };
  } else if (!existing) {
    aiMemory[userNumber] = { summary: '', turns: [] };
  }
  return aiMemory[userNumber];
}

function buildAiPrompt(userNumber, question, quotedContext = null, userName = null) {
  const entry = getAiMemoryEntry(userNumber);
  let convo = '';
  if (entry.summary) {
    convo += `[ملخص لمحادثاتكم السابقة قبل هيك: ${entry.summary}]\n`;
  }
  for (const turn of entry.turns) {
    convo += `المستخدم: ${turn.q}\nالمساعد: ${turn.a}\n`;
  }
  const nameLine = userName
    ? `[اسم المستخدم على واتساب: ${userName} — استخدمو لو ناسب الموقف عشان يحس إنك عارفه، بدون ما تبالغ أو تكرره بكل جملة]\n`
    : '';
  const contextLine = quotedContext ? `[سياق: المستخدم رد على رسالة بتقول: "${quotedContext.slice(0, 300)}"]\n` : '';
  return `${AI_PERSONA}\n\n${nameLine}${convo}${contextLine}المستخدم: ${question}\nالمساعد:`;
}

// ==== 🧠 يلخّص أقدم جزء من المحادثة بالخلفية (بدون ما يأخر الرد على المستخدم) حتى الذاكرة تضل غنية بدون ما تكبر بلا حدود ====
async function summarizeOldTurns(userNumber, oldTurns, previousSummary) {
  try {
    const oldText = oldTurns.map((t) => `س: ${t.q}\nج: ${t.a}`).join('\n');
    const prompt =
      'لخص المحادثة التالية بين مستخدم ومساعد ذكاء اصطناعي بجملتين أو ثلاثة بالعربي وبس، ' +
      'ركز على أي معلومة تفيد بمحادثات جاية (اسمه، اهتماماته، طلبات متكررة، أسلوبه)، بدون تفاصيل زايدة. ' +
      (previousSummary ? `ادمجها مع هاد الملخص السابق: "${previousSummary}"\n\n` : '\n\n') +
      oldText;
    const newSummary = await askGemini(prompt);
    const entry = getAiMemoryEntry(userNumber);
    entry.summary = newSummary.trim().slice(0, 600); // سقف حتى الملخص ما يكبر بلا حدود مع الوقت
    saveAiMemoryDebounced();
  } catch (e) {
    console.log('⚠️ خطأ بتلخيص ذاكرة المستخدم (تم تجاهله، الذاكرة القديمة ضلت متل ما هي):', e.message);
  }
}

function rememberAiTurn(userNumber, question, answer) {
  const entry = getAiMemoryEntry(userNumber);
  entry.turns.push({ q: question, a: answer });
  if (entry.turns.length > AI_MEMORY_MAX_TURNS) {
    const overflow = entry.turns.splice(0, entry.turns.length - AI_MEMORY_MAX_TURNS);
    // تلخيص بالخلفية (fire-and-forget) — ما منستنى نتيجته حتى ما نأخر رد البوت على المستخدم الحالي
    summarizeOldTurns(userNumber, overflow, entry.summary);
  }
  saveAiMemoryDebounced();
}

// ==== 📚 "الذكاء الاصطناعي الخاص فيك": بوت أسئلة وأجوبة ثابتة، إنت اللي بتغذيه بمعلوماته (مو ذكاء مفتوح، ردوده بس من اللي علّمته ياه) ====
const KNOWLEDGE_FILE = '/data/data/com.termux/files/home/mybot/knowledge.json';
let customKnowledge = loadJSON(KNOWLEDGE_FILE, []); // [{ q: 'سؤال', a: 'جواب' }, ...]

function saveKnowledge() {
  saveJSON(KNOWLEDGE_FILE, customKnowledge);
}

// نبسّط أي نص حتى المطابقة تصير أدق (نشيل تشكيل، نوحّد أشكال الألف/التاء المربوطة، نشيل علامات ترقيم)
function normalizeArabicText(str) {
  return str
    .toLowerCase()
    .replace(/[أإآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ًٌٍَُِّْـ]/g, '') // تشكيل
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, '') // نشيل علامات ترقيم ورموز
    .replace(/\s+/g, ' ')
    .trim();
}

// بيدور على أقرب سؤال مخزّن لسؤال المستخدم، بالاعتماد على تطابق الكلمات المشتركة
function findKnowledgeAnswer(question, threshold = 0.5) {
  const normQuestion = normalizeArabicText(question);
  if (!normQuestion) return null;
  const questionWords = new Set(normQuestion.split(' ').filter((w) => w.length > 1));
  if (questionWords.size === 0) return null;

  let bestEntry = null;
  let bestScore = 0;

  for (const entry of customKnowledge) {
    const normEntryQ = normalizeArabicText(entry.q);
    if (normEntryQ === normQuestion) return entry; // تطابق تام، ما في داعي نكمل دور

    const entryWords = normEntryQ.split(' ').filter((w) => w.length > 1);
    if (entryWords.length === 0) continue;
    const common = entryWords.filter((w) => questionWords.has(w)).length;
    const score = common / Math.max(entryWords.length, questionWords.size); // نسبة تشابه

    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  return bestScore >= threshold ? bestEntry : null;
}

// ==== 💾 نسخ احتياطي: يجمع كل ملفات JSON المهمة بملف واحد ويرجع مساره ====
function createBackupBundle() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const bundle = {
    createdAt: new Date().toISOString(),
    banned,
    prayerTimes,
    salawatGroups,
    azkarGroups,
    warnings,
    protectionSettings,
    groupStats,
    points,
    shop,
    commandUsage,
    botSettings,
    reminders,
  };
  const fileName = `backup_${new Date().toISOString().slice(0, 10)}.json`;
  const filePath = `${BACKUP_DIR}/${fileName}`;
  fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2));

  // ==== نحتفظ بآخر 7 نسخ بس، ونحذف الأقدم حتى ما تمتلئ الذاكرة ====
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('backup_'))
      .sort();
    while (files.length > 7) {
      fs.unlinkSync(`${BACKUP_DIR}/${files.shift()}`);
    }
  } catch (e) {
    console.log('⚠️ خطأ بتنظيف النسخ الاحتياطية القديمة:', e.message);
  }

  return filePath;
}

const salawatPhrases = [
  'اللهم صل وسلم وبارك على سيدنا محمد ﷺ',
  'صلى الله عليه وسلم 🌙',
  'اللهم صل على محمد وعلى آل محمد، كما صليت على إبراهيم وعلى آل إبراهيم، إنك حميد مجيد',
  'اللهم صل على محمد النبي الأمي وعلى آله وسلم تسليماً',
  'صلوا على الحبيب المصطفى ﷺ 🌹',
  'اللهم صل وسلم على سيدنا محمد عدد ما ذكره الذاكرون وغفل عن ذكره الغافلون',
];

// ==== 📿 مكتبة أذكار متنوعة (تسبيح، تحميد، تكبير، تهليل، استغفار، عامة) ====
const azkarPhrases = [
  'سبحان الله وبحمده، سبحان الله العظيم 📿',
  'الحمد لله رب العالمين 🤲',
  'الله أكبر كبيراً، والحمد لله كثيراً، وسبحان الله بكرة وأصيلاً',
  'لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير',
  'أستغفر الله العظيم وأتوب إليه 🤲',
  'لا حول ولا قوة إلا بالله العلي العظيم',
  'حسبنا الله ونعم الوكيل',
  'رضيت بالله رباً، وبالإسلام ديناً، وبمحمد نبياً ورسولاً ﷺ',
  'سبحان الله والحمد لله ولا إله إلا الله والله أكبر',
  'اللهم أعنّي على ذكرك وشكرك وحسن عبادتك 🤲',
  'اللهم إني أسألك العفو والعافية 🌿',
  'يا حي يا قيوم برحمتك أستغيث',
  'اللهم اجعل قلبي معموراً بذكرك 📿',
  'سبحان الله وبحمده عدد خلقه ورضا نفسه وزنة عرشه ومداد كلماته',
  'اللهم إنك عفو تحب العفو فاعف عني',
];
let cleanupSchedulerStarted = false;
let weeklySchedulerStarted = false;
let globalSockRef = null; // ==== 🌍 مرجع عام لآخر سوكيت متصل، يستخدم لتنبيه المالك بالواتساب عند صار خطأ غير متوقع ====
let lastCrashAlertTime = 0; // يمنع سبام تنبيهات الأخطاء لو صار نفس الخطأ عالسريع كذا مرة

// ==== 🏅 نظام النقاط والألقاب والجوائز ====
// كل شخص إله نقاط ثابتة حسب رقمه (userId)، بتزيد لما يفوز بالألعاب
function pointsKey(jid) {
  return jid ? resolveOwnerNumber(jid) : jid; // نستخدم resolveOwnerNumber حتى نلتقط أي @lid معروف بـ ADMIN_LID_MAP أيضاً
}

function addPoints(jid, amount) {
  const key = pointsKey(jid);
  if (!key) return 0;
  let finalAmount = amount;
  // ==== 👑 مالك البوت عنده مضاعفة ×5 دايماً وبشكل سري، بدون أي علامة ظاهرة لحدا ====
  if (amount > 0 && isBotOwner(jid)) {
    finalAmount = amount * 5;
    points[key] = (points[key] || 0) + finalAmount;
    saveJSON(POINTS_FILE, points);
    trackWeeklyPoints(key, finalAmount);
    return points[key];
  }
  // إذا عنده مضاعفة نقاط شغالة، بتتضاعف النقاط المكسوبة (×3 لأعضاء البريميوم، ×2 لغيرهم)
  if (amount > 0) {
    const entry = shop[key];
    if (entry && entry.doubleUntil && Date.now() < entry.doubleUntil) {
      const isPremiumNow = entry.premiumUntil && Date.now() < entry.premiumUntil;
      finalAmount = amount * (isPremiumNow ? (entry.premiumMultiplier || 3) : 2);
    }
    // ==== 🐾 قدرة الحيوان الأليف النشط: نسبة إضافية فوق أي مضاعفة تانية ====
    if (entry && entry.activePet) {
      const petItem = findShopItem(entry.activePet);
      if (petItem && petItem.type === 'pet' && petItem.bonusPercent) {
        finalAmount = Math.round(finalAmount * (1 + petItem.bonusPercent / 100));
      }
    }
  }
  points[key] = (points[key] || 0) + finalAmount;
  saveJSON(POINTS_FILE, points);
  trackWeeklyPoints(key, finalAmount);
  return points[key];
}

// ==== 🏆 يضيف النقطة المكسوبة (أو المخصومة) للوحة الصدارة الأسبوعية أيضاً ====
function trackWeeklyPoints(key, amount) {
  if (weeklyLeaderboard.weekStart === getCurrentWeekStartKey()) {
    weeklyLeaderboard.points[key] = (weeklyLeaderboard.points[key] || 0) + amount;
    saveWeekly();
  }
  // لو تغيّر الأسبوع، checkWeeklyReset (يشتغل دوري) رح يصفّرها ويرشّف القديمة قبل ما توصل نقطة جديدة أصلاً
}

function getPoints(jid) {
  const key = pointsKey(jid);
  return (key && points[key]) || 0;
}

// ==== 📅 بيرجع تاريخ "بداية الأسبوع الحالي" (يوم الأحد الساعة 00:00) بصيغة yyyy-mm-dd، نستخدمه كمفتاح مقارنة ====
function getCurrentWeekStartKey() {
  const now = new Date();
  const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  return sunday.toISOString().slice(0, 10);
}

// ==== 🔄 تفحص إذا دخلنا أسبوع جديد؛ لو صار، ترشّف أفضل 3 من الأسبوع الفائت وتصفّر اللوحة، وتعلن الأبطال بكل القروبات (لو زوّدتها sock) ====
async function checkWeeklyReset(sock) {
  const currentWeek = getCurrentWeekStartKey();
  if (weeklyLeaderboard.weekStart === currentWeek) return; // لسا بنفس الأسبوع، ما في داعي نعمل شي

  const isFirstRun = !weeklyLeaderboard.weekStart;
  const finishedWeekEntries = Object.entries(weeklyLeaderboard.points || {})
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (!isFirstRun && finishedWeekEntries.length > 0) {
    const medals = ['🥇', '🥈', '🥉'];
    weeklyLeaderboard.archive.unshift({
      weekStart: weeklyLeaderboard.weekStart,
      weekEnd: currentWeek,
      top: finishedWeekEntries.map(([userId, p], i) => ({ userId, points: p, medal: medals[i] })),
    });
    weeklyLeaderboard.archive = weeklyLeaderboard.archive.slice(0, 12); // آخر 12 أسبوع بس، حتى ما يكبر الملف بلا داعي

    if (sock) {
      const lines = finishedWeekEntries
        .map(([userId, p], i) => `${medals[i]} @${userId} — *${p}* نقطة هالأسبوع`)
        .join('\n');
      const mentionsList = finishedWeekEntries.map(([userId]) => `${userId}@s.whatsapp.net`);
      for (const groupId of Object.keys(groupStats)) {
        try {
          await sock.sendMessage(groupId, {
            text: buildFancyCard(
              '🏆',
              'أبطال الأسبوع الفائت',
              lines,
              '🔄 لوحة الصدارة الأسبوعية صفرت، فرصة جديدة تتصدر! ابدأ بـ .المتصدرين_الاسبوع'
            ),
            mentions: mentionsList,
          });
        } catch (e) {
          // القروب ممكن يكون البوت طلع منه، نتجاهل ونكمل البقية
        }
      }
    }
  }

  weeklyLeaderboard.weekStart = currentWeek;
  weeklyLeaderboard.points = {};
  saveWeekly();
}

// ==== 🛒 متجر النقاط: تشتري ألقاب ومميزات بالنقاط المكسوبة ====
function getShopEntry(jid) {
  const key = pointsKey(jid);
  if (!key) return null;
  if (!shop[key]) {
    shop[key] = {
      title: null, badges: [], activeBadge: null, frames: [], activeFrame: null,
      doubleUntil: null, premiumUntil: null, warnShields: 0, nickname: null,
      dailyTitleActive: false, totalSpent: 0, pets: [], activePet: null,
    };
  }
  // ترقية بيانات قديمة (لو كانت محفوظة قبل إضافة الحقول الجديدة)
  if (!shop[key].frames) shop[key].frames = [];
  if (shop[key].activeFrame === undefined) shop[key].activeFrame = null;
  if (shop[key].premiumUntil === undefined) shop[key].premiumUntil = null;
  if (shop[key].warnShields === undefined) shop[key].warnShields = 0;
  if (shop[key].nickname === undefined) shop[key].nickname = null;
  if (shop[key].dailyTitleActive === undefined) shop[key].dailyTitleActive = false;
  if (shop[key].totalSpent === undefined) shop[key].totalSpent = 0; // 🧾 متغير بسيط: مجموع النقاط اللي صرفها بالمتجر طول عمره
  if (shop[key].premiumMultiplier === undefined) shop[key].premiumMultiplier = 3; // ⚡ مضاعفة نقاط أثناء البريميوم (تختلف حسب فئة VIP)
  if (shop[key].premiumTier === undefined) shop[key].premiumTier = null; // 💠 فضي / ذهبي / ماسي
  if (!shop[key].pets) shop[key].pets = []; // 🐾 الحيوانات الأليفة اللي اشتراها
  if (shop[key].activePet === undefined) shop[key].activePet = null; // 🐾 الحيوان النشط حالياً (يعطي مضاعفة نقاط)
  if (!shop[key].mafiaPerks) shop[key].mafiaPerks = { shield: 0, doubleVote: 0, disguise: 0, revive: 0 }; // 🦠 مقتنيات متجر أمونس الأسطوري (خاصة بلعبة المافيا)
  return shop[key];
}

function saveShop() {
  saveJSON(SHOP_FILE, shop);
}

// بتحاول تخصم نقاط الشراء بس، من غير ما تتأثر بالمضاعفة (المضاعفة للمكسوب بس)
function spendPoints(jid, amount) {
  const key = pointsKey(jid);
  if (!key) return false;
  const current = points[key] || 0;
  if (current < amount) return false;
  points[key] = current - amount;
  saveJSON(POINTS_FILE, points);
  // نسجل مجموع الصرف بالمتجر (متغير بسيط بيخلي الاقتصاد حقيقي أكتر ويبيّن مين أكبر "زبون")
  const entry = getShopEntry(jid);
  if (entry) {
    entry.totalSpent = (entry.totalSpent || 0) + amount;
    saveShop();
  }
  return true;
}

const shopItems = [
  // 🏷️ لقب
  { id: 'لقب', name: '🏷️ لقب مخصص', price: 150, type: 'title', desc: 'اختار لقب خاص فيك يظهر بدل الرتبة ببطاقة نقاطك وبالترتيب' },

  // 🎖 أوسمة
  { id: 'وسام_نجمة', name: '⭐ وسام النجمة', price: 50, type: 'badge', emoji: '⭐' },
  { id: 'وسام_وردة', name: '🌹 وسام الوردة', price: 70, type: 'badge', emoji: '🌹' },
  { id: 'وسام_نار', name: '🔥 وسام النار', price: 80, type: 'badge', emoji: '🔥' },
  { id: 'وسام_موج', name: '🌊 وسام الموج', price: 95, type: 'badge', emoji: '🌊' },
  { id: 'وسام_برق', name: '⚡ وسام البرق', price: 100, type: 'badge', emoji: '⚡' },
  { id: 'وسام_هدف', name: '🎯 وسام الهدف', price: 110, type: 'badge', emoji: '🎯' },
  { id: 'وسام_صاروخ', name: '🚀 وسام الصاروخ', price: 120, type: 'badge', emoji: '🚀' },
  { id: 'وسام_فراشة', name: '🦋 وسام الفراشة', price: 90, type: 'badge', emoji: '🦋' },
  { id: 'وسام_اسد', name: '🦁 وسام الأسد', price: 180, type: 'badge', emoji: '🦁' },
  { id: 'وسام_تاج', name: '👑 وسام التاج', price: 150, type: 'badge', emoji: '👑' },
  { id: 'وسام_ماسة', name: '💎 وسام الماسة', price: 250, type: 'badge', emoji: '💎' },
  { id: 'وسام_تنين', name: '🐉 وسام التنين', price: 320, type: 'badge', emoji: '🐉' },

  // 🖼 إطارات البروفايل (تلف حول اسمك/لقبك ببطاقتك وبروفايلك)
  { id: 'اطار_نجوم', name: '✦ إطار النجوم', price: 120, type: 'frame', frame: '✦' },
  { id: 'اطار_ورد', name: '🌸 إطار الورد', price: 140, type: 'frame', frame: '🌸' },
  { id: 'اطار_ناري', name: '🔥 إطار ناري', price: 180, type: 'frame', frame: '🔥' },
  { id: 'اطار_ملكي', name: '👑 إطار ملكي', price: 220, type: 'frame', frame: '👑' },

  // ⚡ مضاعفات النقاط
  { id: 'مضاعفة', name: '⚡ مضاعفة النقاط 24 ساعة', price: 100, type: 'double', hours: 24, desc: 'كل نقطة تكسبها من الألعاب لمدة 24 ساعة تتضاعف ×2' },
  { id: 'مضاعفة_3ايام', name: '⚡ مضاعفة النقاط 3 أيام', price: 250, type: 'double', hours: 72, desc: 'كل نقطة تكسبها من الألعاب لمدة 3 أيام تتضاعف ×2' },
  { id: 'مضاعفة_اسبوع', name: '⚡ مضاعفة النقاط أسبوع كامل', price: 500, type: 'double', hours: 168, desc: 'كل نقطة تكسبها من الألعاب لمدة أسبوع تتضاعف ×2' },

  // 🛡 حماية وحظ ولمسات شخصية (أغراض جديدة بالمتجر العادي)
  { id: 'حماية_تحذير', name: '🛡️ تذكرة حماية من إنذار', price: 60, type: 'warnshield', desc: 'تحميك تلقائياً من أول إنذار جاي بسبب رابط/كلمة ممنوعة/سبام (تُستهلك مرة وحدة)' },
  { id: 'صندوق_حظ', name: '🎁 صندوق حظ', price: 40, type: 'luckybox', desc: 'افتحه فوراً وجرب حظك! ممكن تربح نقاط كتير... أو تخسر شوي 😄' },
  { id: 'لقب_يومي', name: '🎭 اشتراك لقب يومي متغير', price: 80, type: 'dailytitle', desc: 'كل يوم يطلعلك لقب مختلف وطريف بدل رتبتك الثابتة، وبيضل يتجدد لحالو' },
  { id: 'اسم_مستعار', name: '📛 اسم مستعار', price: 100, type: 'nickname', desc: 'اسم مستعار شخصي يظهر بمقتنياتك وبروفايلك' },

  // 💠 3 فئات VIP بريميوم (كل فئة أفخم من يلي قبلها — سعر أعلى، مضاعفة أكبر، مؤقتة 30 يوم)
  {
    id: 'بريميوم_فضي',
    name: '🥈 عضوية VIP فضية (30 يوم)',
    price: 5000,
    type: 'premium',
    tier: 'فضي',
    multiplier: 2,
    emoji: '🥈',
    frame: '✦',
    hours: 720,
    desc: 'وسام وإطار حصريين، مضاعفة نقاط ×2، حصانة من إنذارات النظام، إحصائيات VIP — وبعدها لازم تجددها',
  },
  {
    id: 'بريميوم_ذهبي',
    name: '🥇 عضوية VIP ذهبية (30 يوم)',
    price: 10000,
    type: 'premium',
    tier: 'ذهبي',
    multiplier: 3,
    emoji: '💠',
    frame: '💎',
    hours: 720,
    desc: 'وسام وإطار حصريين، مضاعفة نقاط ×3، حصانة من إنذارات النظام، إحصائيات VIP، سؤال ذكاء اصطناعي حصري، وعلامة 💠VIP ثابتة جنب اسمك — وبعدها لازم تجددها',
  },
  {
    id: 'بريميوم_ماسي',
    name: '💎 عضوية VIP ماسية (30 يوم)',
    price: 18000,
    type: 'premium',
    tier: 'ماسي',
    multiplier: 4,
    emoji: '💎',
    frame: '👑',
    hours: 720,
    desc: 'أرقى فئة بالمتجر: وسام وإطار ملكيين حصريين، مضاعفة نقاط ×4، حصانة من إنذارات النظام، إحصائيات VIP، سؤال ذكاء اصطناعي حصري، أولوية بالمزايدة، وعلامة 💎VIP ثابتة جنب اسمك — وبعدها لازم تجددها',
  },

  // 🍂 أغراض موسمية حصرية (بتظهر وتنشترى بس بموسمها — season بالشهور الميلادية 1-12)
  { id: 'وسام_شتوي', name: '❄️ وسام الشتاء', price: 200, type: 'badge', emoji: '❄️', seasonal: true, season: [12, 1, 2], desc: 'غرض موسمي حصري، بيتوفر بس بأشهر الشتاء' },
  { id: 'اطار_صيفي', name: '☀️ إطار الصيف', price: 200, type: 'frame', frame: '☀️', seasonal: true, season: [6, 7, 8], desc: 'غرض موسمي حصري، بيتوفر بس بأشهر الصيف' },
  { id: 'وسام_خريفي', name: '🍁 وسام الخريف', price: 200, type: 'badge', emoji: '🍁', seasonal: true, season: [9, 10, 11], desc: 'غرض موسمي حصري، بيتوفر بس بأشهر الخريف' },
  { id: 'اطار_ربيعي', name: '🌷 إطار الربيع', price: 200, type: 'frame', frame: '🌷', seasonal: true, season: [3, 4, 5], desc: 'غرض موسمي حصري، بيتوفر بس بأشهر الربيع' },

  // ✨ أغراض جديدة (تنويع)
  { id: 'وسام_نجمة_ذهبية', name: '🌟 وسام النجمة الذهبية', price: 200, type: 'badge', emoji: '🌟' },
  { id: 'وسام_جوهرة', name: '💍 وسام الجوهرة', price: 280, type: 'badge', emoji: '💍' },
  { id: 'وسام_فينيق', name: '🦅 وسام الفينيق', price: 260, type: 'badge', emoji: '🦅' },
  { id: 'اطار_كوني', name: '🌌 إطار كوني', price: 300, type: 'frame', frame: '🌌' },
  { id: 'اطار_ماسي', name: '💠 إطار ماسي', price: 260, type: 'frame', frame: '💠' },

  // 🐾 حيوانات أليفة حصرية — كل وحش قدرة خاصة تساعدك تجمع نقاط أكتر (غرض دائم، تقدر تبدّل بينهم لو عندك أكتر من وحد)
  { id: 'قطة_الحظ', name: '🐱 قطة الحظ', price: 800, type: 'pet', emoji: '🐱', bonusPercent: 5, exclusive: true, desc: 'قدرة خاصة: +5% نقاط إضافية على كل نقطة تكسبها من الألعاب' },
  { id: 'كلب_وفي', name: '🐶 الكلب الوفي', price: 1200, type: 'pet', emoji: '🐶', bonusPercent: 8, exclusive: true, desc: 'قدرة خاصة: +8% نقاط إضافية على كل نقطة تكسبها من الألعاب' },
  { id: 'بومة_حكيمة', name: '🦉 البومة الحكيمة', price: 1800, type: 'pet', emoji: '🦉', bonusPercent: 12, exclusive: true, desc: 'قدرة خاصة: +12% نقاط إضافية على كل نقطة تكسبها من الألعاب' },
  { id: 'ثعلب_ماكر', name: '🦊 الثعلب الماكر', price: 2500, type: 'pet', emoji: '🦊', bonusPercent: 15, exclusive: true, desc: 'قدرة خاصة: +15% نقاط إضافية على كل نقطة تكسبها من الألعاب' },
  { id: 'ذئب_اسطوري', name: '🐺 الذئب الأسطوري', price: 4000, type: 'pet', emoji: '🐺', bonusPercent: 20, exclusive: true, desc: 'قدرة خاصة: +20% نقاط إضافية على كل نقطة تكسبها من الألعاب' },
  { id: 'تنين_نادر', name: '🐉 التنين النادر', price: 7000, type: 'pet', emoji: '🐉', bonusPercent: 30, exclusive: true, desc: 'أندر حيوان بالمتجر! قدرة خاصة: +30% نقاط إضافية على كل نقطة تكسبها من الألعاب' },

  // 🦠 متجر أمونس الأسطوري — أغراض قوى خاصة تُستخدم بلعبة المافيا بس، وتُستهلك تلقائياً بالوقت المناسب
  { id: 'درع_امونس', name: '🛡️ درع أمونس', price: 80, type: 'mafia_perk', perkKey: 'shield', desc: 'بيحميك تلقائياً أول مرة تنقتل/تنهرّب فيها بالليل بأي لعبة مافيا (يُستهلك عند الاستخدام)' },
  { id: 'نفوذ_امونس', name: '👑 نفوذ أمونس المضاعف', price: 70, type: 'mafia_perk', perkKey: 'doubleVote', desc: 'صوتك بالتصويت النهاري يساوي صوتين لمرة وحدة (يُستهلك بأول لعبة تلعبها بعد الشراء)' },
  { id: 'قناع_امونس', name: '🎭 قناع أمونس', price: 90, type: 'mafia_perk', perkKey: 'disguise', desc: 'لو المحقق حقق فيك وأنت مافيا، النتيجة بتطلع بريء لمرة وحدة' },
  { id: 'بعث_امونس', name: '💀 بعث أمونس الأسطوري', price: 250, type: 'mafia_perk', perkKey: 'revive', desc: '⚜️ غرض أسطوري نادر! لو انقتلت أو انطردت بالتصويت، بترجع للحياة فوراً بنفس اللعبة (مرة وحدة)' },
];

// ==== 🎭 ألقاب يومية طريفة (لأصحاب اشتراك اللقب المتغير) — نفس اللقب طول اليوم بعدها يتبدل ====
const dailyFunnyTitles = [
  'ملك القروب 😎', 'أسطورة اليوم 🌟', 'زعيم الفوضى 😂', 'نجم الليلة ✨', 'بطل بلا منازع 🥇',
  'أسرع من الضوء ⚡', 'حكيم القروب 🧙', 'مصدر الطاقة الإيجابية 🔋', 'خبير المزح 🤡', 'الأسطورة الصامتة 🥷',
  'قائد الفريق 🫡', 'نجم صاعد 🚀', 'شمس القروب ☀️', 'ملهم اليوم 💡', 'بطل الكواليس 🎬',
];

function getDailyTitleFor(key) {
  const dayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000)); // رقم اليوم منذ epoch
  let hash = 0;
  for (const ch of String(key)) hash = (hash * 31 + ch.charCodeAt(0)) % 100000;
  const idx = (dayIndex + hash) % dailyFunnyTitles.length;
  return dailyFunnyTitles[idx];
}

// ==== 🎁 نتائج صندوق الحظ (احتمالات مختلفة) ====
const luckyBoxOutcomes = [
  { weight: 30, min: 5, max: 20 },
  { weight: 25, min: 21, max: 50 },
  { weight: 15, min: 51, max: 100 },
  { weight: 20, min: -20, max: -5 }, // خسارة بسيطة
  { weight: 10, min: 0, max: 0 }, // ولا شي (صندوق فاضي)
];

function rollLuckyBox() {
  const totalWeight = luckyBoxOutcomes.reduce((sum, o) => sum + o.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const outcome of luckyBoxOutcomes) {
    if (roll < outcome.weight) {
      return Math.floor(Math.random() * (outcome.max - outcome.min + 1)) + outcome.min;
    }
    roll -= outcome.weight;
  }
  return 0;
}

// ==== 💠 نظام البريميوم: مؤقت وقابل للتجديد، مش دائم ====
const PREMIUM_BADGE = '💠';
const PREMIUM_FRAME = '💎';

function isPremiumActive(entry) {
  return !!(entry && entry.premiumUntil && Date.now() < entry.premiumUntil);
}

// الوسام الفعلي المعروض: لو الوسام النشط هو وسام البريميوم بس البريميوم خلص، ما نعرضه
function getEffectiveBadge(entry) {
  if (!entry) return null;
  if (entry.activeBadge === PREMIUM_BADGE && !isPremiumActive(entry)) return null;
  return entry.activeBadge || null;
}

// نفس المنطق للإطار
function getEffectiveFrame(entry) {
  if (!entry) return null;
  if (entry.activeFrame === PREMIUM_FRAME && !isPremiumActive(entry)) return null;
  return entry.activeFrame || null;
}

function findShopItem(id) {
  const clean = (id || '').trim();
  return shopItems.find((it) => it.id === clean) || null;
}

// ==== 🧾 دالة تبني "إيصال شراء" منظم بشكل بطاقة (بنفس روح بطاقة بنك أمونس) — تُستخدم بعد كل عملية شراء ناجحة ====
function buildPurchaseReceipt(sender, item, effectivePrice, headline, detailLines) {
  const divider = '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈';
  const remaining = getPoints(sender).toLocaleString('en-US');
  const priceFormatted = effectivePrice.toLocaleString('en-US');
  const details = (detailLines || []).filter(Boolean).map((l) => `↳ ${l}`).join('\n');
  return (
    '🧾 ⟪ إيصال شراء - أمونس ⟫\n' +
    `${divider}\n` +
    `✅ ${headline}\n` +
    `🛍️ الغرض: ${item.emoji || ''} ${item.name}\n` +
    `💵 السعر المدفوع: ${priceFormatted} نقطة\n` +
    (details ? `${details}\n` : '') +
    `${divider}\n` +
    `💰 رصيدك المتبقي: ${remaining} نقطة\n` +
    `${divider}\n` +
    '🏢 شركة أمونس العالمية'
  );
}

// ==== 🏷️ عرض اليوم: كل يوم غرض عشوائي بخصم، بيتغير تلقائياً حسب تاريخ اليوم ====
// (سعر ثابت، بدون لقب/اسم مستعار/بريميوم — عشان يضل التطبيق بسيط وواضح)
const dailyDealPool = shopItems.filter((it) =>
  ['badge', 'frame', 'double', 'warnshield', 'luckybox', 'dailytitle'].includes(it.type)
);

function getDailyDeal() {
  if (dailyDealPool.length === 0) return null;
  const dayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  const idx = dayIndex % dailyDealPool.length;
  const item = dailyDealPool[idx];
  const discountPct = 20 + (dayIndex % 3) * 5; // يتناوب بين 20% و25% و30%
  const discountedPrice = Math.max(1, Math.round(item.price * (1 - discountPct / 100)));
  return { item, discountPct, discountedPrice };
}

// ==== 🍂 هل الغرض الموسمي متاح بالشهر الحالي؟ ====
function isSeasonalItemAvailable(item) {
  if (!item.seasonal || !item.season) return true;
  const currentMonth = new Date().getMonth() + 1;
  return item.season.includes(currentMonth);
}

// ==== 🔨 نظام المزاد: أغراض نادرة (أوسمة/إطارات سعرها 150+) تصلح كأغراض مزايدة ====
const auctionPool = shopItems.filter((it) => ['badge', 'frame'].includes(it.type) && it.price >= 150 && isSeasonalItemAvailable(it));

function getRandomAuctionItem() {
  const pool = shopItems.filter((it) => ['badge', 'frame'].includes(it.type) && it.price >= 150 && isSeasonalItemAvailable(it));
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

const AUCTION_DURATION_MS = 15 * 60 * 1000; // 15 دقيقة
const AUCTION_MIN_INCREMENT = 10; // أقل زيادة مقبولة على المزايدة السابقة

function formatAuctionTimeLeft(endsAt) {
  const msLeft = endsAt - Date.now();
  if (msLeft <= 0) return 'خلص الوقت';
  const minutes = Math.floor(msLeft / 60000);
  const seconds = Math.floor((msLeft % 60000) / 1000);
  return `${minutes} د ${seconds} ث`;
}

// ==== 🏆 حسم المزاد: تعطي الغرض لصاحب أعلى مزايدة وتخصم نقاطه، أو تعلن ما في فايز ====
async function resolveAuction(sock, groupId) {
  const auction = auctions[groupId];
  if (!auction) return;
  delete auctions[groupId];
  saveAuctions();

  const item = findShopItem(auction.itemId);
  if (!item) return;

  if (!auction.currentBidderKey) {
    try {
      await sock.sendMessage(groupId, {
        text: `🔨 ✦ *انتهى المزاد!* ✦\n${item.emoji || item.frame} *${item.name}*\n\n😅 ما حد زايد عليه، رجع الغرض للمخزن.`,
      });
    } catch (e) {}
    return;
  }

  const winnerJid = `${auction.currentBidderKey}@s.whatsapp.net`;
  const winnerPoints = getPoints(winnerJid);

  if (winnerPoints < auction.currentBid) {
    try {
      await sock.sendMessage(groupId, {
        text: `🔨 ✦ *انتهى المزاد!* ✦\n${item.emoji || item.frame} *${item.name}*\n\n⚠️ الفايز @${auction.currentBidderKey} نقاطه صارت مش كافية وقت الحسم، رجع الغرض للمخزن.`,
        mentions: [winnerJid],
      });
    } catch (e) {}
    return;
  }

  spendPoints(winnerJid, auction.currentBid);
  const entry = getShopEntry(winnerJid);
  if (item.type === 'badge') {
    if (!entry.badges.includes(item.id)) entry.badges.push(item.id);
    if (!entry.activeBadge) entry.activeBadge = item.emoji;
  } else if (item.type === 'frame') {
    if (!entry.frames.includes(item.id)) entry.frames.push(item.id);
    if (!entry.activeFrame) entry.activeFrame = item.frame;
  }
  saveShop();

  try {
    await sock.sendMessage(groupId, {
      text:
        `🔨🎉 ✦ *انتهى المزاد!* ✦ 🎉🔨\n\n` +
        `${item.emoji || item.frame} *${item.name}*\n` +
        `🏆 الفايز: @${auction.currentBidderKey}\n` +
        `💰 بسعر: *${auction.currentBid}* نقطة\n\n` +
        `مبروك! 🎊`,
      mentions: [winnerJid],
    });
  } catch (e) {}
}

// النص اللي بيظهر جنب اسم الشخص: لقبه المخصص إذا عنده، وإلا لقبه اليومي إذا مفعّل، وإلا رتبته العادية
function getDisplayTitle(jid, pointsAmount) {
  const entry = getShopEntry(jid);
  const rank = getRank(pointsAmount);
  const effectiveBadge = getEffectiveBadge(entry);
  const effectiveFrame = getEffectiveFrame(entry);
  const badgePrefix = effectiveBadge ? `${effectiveBadge} ` : '';
  let shownTitle = rank.title;
  if (entry && entry.title) {
    shownTitle = entry.title;
  } else if (entry && entry.dailyTitleActive) {
    shownTitle = getDailyTitleFor(pointsKey(jid));
  }
  const core = `${badgePrefix}${rank.emoji} ${shownTitle}`;
  // ==== 👑 مالك البوت ما تظهر عنده علامة VIP إطلاقاً، حتى لو كانت مفعّلة فعلياً (سرية تماماً) ====
  const vipTag = !isBotOwner(jid) && isPremiumActive(entry) ? ' 💠VIP' : '';
  if (effectiveFrame) {
    return `${effectiveFrame} ${core}${vipTag} ${effectiveFrame}`;
  }
  return `${core}${vipTag}`;
}

// ==== 🎖 مستويات الألقاب حسب مجموع النقاط ====
const rankTiers = [
  { min: 0, title: 'مبتدئ', emoji: '🌱' },
  { min: 20, title: 'لاعب صاعد', emoji: '⭐' },
  { min: 50, title: 'محترف', emoji: '🔥' },
  { min: 100, title: 'خبير', emoji: '💎' },
  { min: 200, title: 'أسطورة', emoji: '👑' },
  { min: 500, title: 'إمبراطور الألعاب', emoji: '🏆' },
];

function getRank(p) {
  let current = rankTiers[0];
  for (const tier of rankTiers) {
    if (p >= tier.min) current = tier;
  }
  const idx = rankTiers.indexOf(current);
  const next = rankTiers[idx + 1] || null;
  return { title: current.title, emoji: current.emoji, next };
}

// ==== 🏆 ميداليات إنجاز تلقائية — تُمنح عند الوصول لنقاط معيّنة (منفصلة عن الرتب والمتجر) ====
const achievements = [
  { min: 30, emoji: '🥉', name: 'إنجاز برونزي' },
  { min: 75, emoji: '🥈', name: 'إنجاز فضي' },
  { min: 150, emoji: '🥇', name: 'إنجاز ذهبي' },
  { min: 300, emoji: '🏅', name: 'وسام الشرف' },
  { min: 500, emoji: '🏆', name: 'بطل القروب' },
];

function getEarnedAchievements(p) {
  return achievements.filter((a) => p >= a.min);
}

// ==== 🎖️ إنجازات موسّعة تعتمد على إحصائيات الأداء (مو بس النقاط) — أمر .انجازاتي ====
const statAchievements = [
  { key: 'gamesWon', min: 10, emoji: '🎮', name: 'لاعب نشيط', desc: 'اربح 10 ألعاب' },
  { key: 'gamesWon', min: 50, emoji: '🕹️', name: 'محترف الألعاب', desc: 'اربح 50 لعبة' },
  { key: 'gamesWon', min: 150, emoji: '👾', name: 'أسطورة الألعاب', desc: 'اربح 150 لعبة' },
  { key: 'jobsWorked', min: 10, emoji: '💼', name: 'موظف مجتهد', desc: 'اشتغل 10 مرات' },
  { key: 'jobsWorked', min: 50, emoji: '👔', name: 'رجل أعمال', desc: 'اشتغل 50 مرة' },
  { key: 'investWins', min: 5, emoji: '📈', name: 'مستثمر ذكي', desc: 'اربح بالاستثمار 5 مرات' },
  { key: 'investWins', min: 20, emoji: '💹', name: 'ثعلب البورصة', desc: 'اربح بالاستثمار 20 مرة' },
  { key: 'mafiaWins', min: 1, emoji: '🕵️', name: 'عقل المافيا', desc: 'اربح لعبة مافيا مرة وحدة' },
  { key: 'mafiaWins', min: 10, emoji: '🎭', name: 'زعيم العصابة', desc: 'اربح 10 ألعاب مافيا' },
];

// تفحص إذا الشخص فتح إنجاز إحصائي جديد بعد ما زادت قيمة إحصائية معينة، وبتعلنه بالقروب
async function checkStatAchievement(sock, from, sender, statKey, beforeValue, afterValue) {
  const newlyEarned = statAchievements.filter(
    (a) => a.key === statKey && beforeValue < a.min && afterValue >= a.min
  );
  for (const a of newlyEarned) {
    try {
      await sock.sendMessage(from, {
        text:
          `${a.emoji} ✦ *إنجاز جديد!* ✦\n` +
          `@${sender.split('@')[0]} فتح إنجاز *${a.name}* ${a.emoji}\n` +
          `↳ ${a.desc}`,
        mentions: [sender],
      });
    } catch (e) {
      // تجاهل
    }
  }
}

// بتضيف نقاط للاعب وبتعلن ميدالية جديدة تلقائياً إذا تخطى حد معيّن (تُستخدم بعد كل فوز بلعبة)
async function awardPointsWithAchievement(sock, from, sender, amount) {
  const before = getPoints(sender);
  const after = addPoints(sender, amount);
  const achievement = achievements.find((a) => before < a.min && after >= a.min);
  if (achievement) {
    await sock.sendMessage(from, {
      text:
        `${achievement.emoji} ✦ *إنجاز جديد!* ✦\n` +
        `@${sender.split('@')[0]} فتح ميدالية *${achievement.name}* ${achievement.emoji} بوصوله لـ *${achievement.min}* نقطة! 🎊`,
      mentions: [sender],
    });
  }
  // ==== 🎮 نتابع عدد الألعاب المكسوبة لكل شخص (تُستخدم بإنجازات .انجازاتي) ====
  const stats = getStatsEntry(sender);
  const winsBefore = stats.gamesWon;
  stats.gamesWon = winsBefore + 1;
  saveStats();
  await checkStatAchievement(sock, from, sender, 'gamesWon', winsBefore, stats.gamesWon);
  return after;
}

// ==== قائمة الكلمات الممنوعة (عدّلها زي ما بدك، ضيف كلمات بلهجتك) ====
const badWords = [
  'غبي', 'حقير', 'كلب', 'حمار', 'خرا', 'وسخ', 'قذر', 'تافه', 'زبالة',
  'حيوان', 'وقح', 'كذاب', 'خنزير', 'يلعن', 'لعنة', 'منحط', 'حقيرة', 'عاهرة',
]; // ضيف/احذف كلمات حسب رغبتك

// ==== نمط اكتشاف الروابط والدعوات ====
const linkPattern = /(https?:\/\/|www\.|chat\.whatsapp\.com|t\.me\/)/i;

// ==== حالة الألعاب (بالذاكرة، تنمسح لو أعيد تشغيل البوت) ====
const numberGames = {}; // { chatId: { target, attempts } }
const quizGames = {}; // { chatId: { answer } }
const rpsChallenges = {}; // { groupId: { challenger, opponent, choices: {} } }
const xoGames = {}; // { groupId: { p1, p2, board: [9], turn: 'p1'|'p2', symbols: {p1,p2}, lastMoveAt } }
const wordChainGames = {}; // { groupId: { lastLetter, usedWords: Set, round, scores: {userKey: points}, roundId, startedAt } }
const VIRTUAL_PLAYER_KEY = 'اللاعب_الافتراضي🤖';

// ==== 🔤 لعبة سلسلة الكلمات: كل كلمة لازم تبلش بآخر حرف من الكلمة يلي قبلها، وما تتكرر ====
const WORD_CHAIN_ROUND_TIMEOUT_MS = 45 * 1000; // 45 ثانية لكل دور قبل ما تنتهي اللعبة كلها
const wordChainStarterBank = [
  'قمر', 'شمس', 'بحر', 'جبل', 'نهر', 'وردة', 'سماء', 'أرض', 'نجمة', 'غيمة',
  'مدرسة', 'كتاب', 'قلم', 'حاسوب', 'هاتف', 'سيارة', 'طائرة', 'باخرة', 'دراجة', 'ساعة',
  'مفتاح', 'باب', 'نافذة', 'طاولة', 'كرسي', 'حديقة', 'شجرة', 'زهرة', 'فراشة', 'عصفور',
  'أسد', 'نمر', 'ذئب', 'غزال', 'حصان', 'جمل', 'دجاجة', 'سمكة', 'تمساح', 'فيل',
  'قهوة', 'شاي', 'عسل', 'تفاح', 'موز', 'برتقال', 'خبز', 'لبن', 'جبنة', 'تمر',
];

// ==== 🧹 نطبّع الكلمة العربية: نشيل التشكيل والتطويل، ونوحّد أشكال الألف والياء والتاء المربوطة، حتى المطابقة تكون عادلة ====
function normalizeArabicWord(word) {
  return (word || '')
    .trim()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '') // شيل التشكيل والتطويل
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

function isArabicWord(normalized) {
  return /^[\u0621-\u064A]+$/.test(normalized);
}

async function endWordChainGame(sock, from, reason, extraMentions = []) {
  const game = wordChainGames[from];
  if (!game) return;
  delete wordChainGames[from];

  const scoreEntries = Object.entries(game.scores).sort((a, b) => b[1] - a[1]);
  const mentionsList = [...new Set([...extraMentions, ...scoreEntries.map(([userKey]) => `${userKey}@s.whatsapp.net`)])];
  const scoreLines = scoreEntries.length > 0
    ? scoreEntries.map(([userKey, pts], i) => `${i === 0 ? '🥇' : `${i + 1}.`} @${userKey} — ${pts} نقطة`).join('\n')
    : 'محدا سجّل نقطة هالجولة 😅';

  await sock.sendMessage(from, {
    text: buildFancyCard(
      '🔤',
      'انتهت لعبة سلسلة الكلمات',
      `${reason}\n\n📊 عدد الكلمات: *${game.round}*\n\n🏆 *نتائج الجلسة:*\n${scoreLines}`,
      '🔁 ابدأ جولة جديدة بـ .سلسلة_كلمات'
    ),
    mentions: mentionsList,
  });
}

function scheduleWordChainTimeout(sock, from, roundId) {
  setTimeout(async () => {
    const game = wordChainGames[from];
    if (!game || game.roundId !== roundId) return; // في جولة أحدث أو اللعبة خلصت أصلاً، هاد المؤقّت ما عاد يعنيه شي
    await endWordChainGame(sock, from, `⏰ ما حدا جاوب خلال ${WORD_CHAIN_ROUND_TIMEOUT_MS / 1000} ثانية.`);
  }, WORD_CHAIN_ROUND_TIMEOUT_MS);
}

// ==== 🤖 اللاعب الافتراضي أحياناً بيشتري غرض من المتجر لو عنده نقاط كافية (للمرح بس) ====
function maybeVirtualPlayerShops() {
  const balance = getPoints(VIRTUAL_PLAYER_KEY);
  if (balance < 50) return null;
  if (Math.random() > 0.3) return null; // 30% احتمال بس، مش كل مرة

  const affordable = shopItems.filter((it) => it.type === 'badge' && it.price <= balance);
  if (affordable.length === 0) return null;

  const item = affordable[Math.floor(Math.random() * affordable.length)];
  if (!spendPoints(VIRTUAL_PLAYER_KEY, item.price)) return null;

  const entry = getShopEntry(VIRTUAL_PLAYER_KEY);
  if (!entry.badges.includes(item.id)) entry.badges.push(item.id);
  if (!entry.activeBadge) entry.activeBadge = item.emoji;
  saveShop();

  return item.name;
}

// ==== ⚔️ حل نتيجة تحدي حجر-ورق-مقص، بيدعم لاعب افتراضي بدل أي طرف غايب ====
async function resolveRpsChallenge(sock, from, challenge) {
  if (!rpsChallenges[from] || rpsChallenges[from] !== challenge) return;
  delete rpsChallenges[from];

  const { challenger, opponent, choices, virtualSide } = challenge;
  const c1 = choices[challenger];
  const c2 = choices[opponent];

  const nameOf = (side, jid) =>
    virtualSide === side ? '🤖 *اللاعب الافتراضي*' : `@${jid.split('@')[0]}`;
  const challengerName = nameOf('challenger', challenger);
  const opponentName = nameOf('opponent', opponent);

  let resultText;
  let extraNote = '';

  if (c1 === c2) {
    resultText = '🤝 *تعادل!* نفس الاختيار بالظبط.';
  } else {
    const challengerWins =
      (c1 === 'حجر' && c2 === 'مقص') || (c1 === 'ورق' && c2 === 'حجر') || (c1 === 'مقص' && c2 === 'ورق');
    const winnerSide = challengerWins ? 'challenger' : 'opponent';
    const winnerJid = challengerWins ? challenger : opponent;
    const winnerName = challengerWins ? challengerName : opponentName;

    if (virtualSide === winnerSide) {
      // ==== اللاعب الافتراضي هو الفايز، ياخذ نقاطه الخاصة وممكن يشتري من المتجر ====
      const newTotal = addPoints(VIRTUAL_PLAYER_KEY, 10);
      resultText = `🏆 فاز ${winnerName}! (+10 نقطة، رصيده الآن: ${newTotal})`;
      const bought = maybeVirtualPlayerShops();
      if (bought) {
        extraNote = `\n\n🛒 اللاعب الافتراضي اشترى *${bought}* من المتجر بنقاطه! 😎`;
      }
    } else {
      const newTotal = addPoints(winnerJid, 10);
      resultText = `🏆 فاز ${winnerName}! (+10 نقطة، المجموع: ${newTotal})`;
    }
  }

  await sock.sendMessage(from, {
    text:
      `╔═══════════════╗\n` +
      `   ⚔️ *نتيجة التحدي* ⚔️\n` +
      `╚═══════════════╝\n\n` +
      `${challengerName}: *${c1}*\n` +
      `${opponentName}: *${c2}*\n\n` +
      `${resultText}${extraNote}`,
    mentions: [challenger, opponent],
  });
}

// ==== ⭕❌ لعبة اكس أو (Tic-Tac-Toe): دوال مساعدة لرسم اللوحة وفحص الفوز ====
const XO_NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣']; // ==== أرقام الخانات الفاضية، حتى اللاعب يشوف بالظبط شو رقم الخانة يلي بدو يحطه بـ .حرك ====
const XO_WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // صفوف
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // أعمدة
  [0, 4, 8], [2, 4, 6], // أقطار
];

// ==== نرسم اللوحة 3×3: الخانة الفاضية تطلع برقمها الفعلي (1-9)، والخانة المشغولة تطلع برمز اللاعب ====
function renderXoBoard(board) {
  const cell = (i) => (board[i] ? `${board[i]} ` : XO_NUMBERS[i]);
  return (
    `${cell(0)}${cell(1)}${cell(2)}\n` +
    `${cell(3)}${cell(4)}${cell(5)}\n` +
    `${cell(6)}${cell(7)}${cell(8)}`
  );
}

function checkXoWinner(board) {
  for (const [a, b, c] of XO_WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

function isXoBoardFull(board) {
  return board.every((c) => c !== null);
}

async function sendXoBoard(sock, from, game, extraText = '') {
  const currentJid = game[game.turn];
  const currentSymbol = game.symbols[game.turn];
  await sock.sendMessage(from, {
    text: buildFancyCard(
      '⭕',
      'اكس أو',
      `${extraText}${renderXoBoard(game.board)}\n\n` +
        `🎯 دور: @${currentJid.split('@')[0]} (${currentSymbol})\n` +
        `📝 اكتب رقم الخانة (1-9) بس، أو .حرك <رقم>`
    ),
    mentions: [game.p1, game.p2],
  });
}

// ==== ⭕❌ تنفيذ حركة فعلية بلعبة اكس أو — تستخدم من أمر .حرك ومن الرقم المباشر (بدون أمر) لنفس المنطق بالضبط ====
async function applyXoMove(sock, from, sender, pos) {
  const game = xoGames[from];
  if (!game) {
    await sock.sendMessage(from, { text: '⚠️ ما في لعبة اكس أو شغالة هون. ابدأ وحدة بـ .اكس_او @شخص' });
    return;
  }
  // 🔑 نقارن برقم الهاتف بس (pointsKey) مش الجيد الكامل، لأنه واتساب أحياناً بيرجع نفس الشخص
  // بصيغة @lid لما تعمله منشن وبصيغة @s.whatsapp.net لما هو يبعت رسالة، فالمقارنة الحرفية كانت تفشل
  // وتخلي الخصم يوصله "هاي مو لعبتك" حتى لو هو فعلاً اللاعب الصحيح.
  const senderKey = pointsKey(sender);
  const isP1 = senderKey === pointsKey(game.p1);
  const isP2 = senderKey === pointsKey(game.p2);
  if (!isP1 && !isP2) {
    await sock.sendMessage(from, { text: '⚠️ هاي مو لعبتك، ما تقدر تلعب فيها.' });
    return;
  }
  const mySide = isP1 ? 'p1' : 'p2';
  if (game.turn !== mySide) {
    await sock.sendMessage(from, { text: '⚠️ لسا مو دورك، استنى دور صاحبك.' });
    return;
  }
  if (isNaN(pos) || pos < 1 || pos > 9) {
    await sock.sendMessage(from, { text: '⚠️ اكتب رقم خانة من 1 لـ 9، مثال: 5 أو .حرك 5' });
    return;
  }
  const idx = pos - 1;
  if (game.board[idx]) {
    await sock.sendMessage(from, { text: '⚠️ هاي الخانة محجوزة، اختار خانة فاضية.' });
    return;
  }

  game.board[idx] = game.symbols[mySide];
  game.lastMoveAt = Date.now();

  const winnerSymbol = checkXoWinner(game.board);
  if (winnerSymbol) {
    const winnerJid = game[mySide];
    const newTotal = addPoints(winnerJid, 15);
    delete xoGames[from];
    await sock.sendMessage(from, {
      text: buildFancyCard(
        '🏆',
        'اكس أو - انتهت اللعبة',
        `${renderXoBoard(game.board)}\n\n🏆 فاز @${winnerJid.split('@')[0]}! (+15 نقطة، المجموع: ${newTotal})`
      ),
      mentions: [game.p1, game.p2],
    });
    return;
  }

  if (isXoBoardFull(game.board)) {
    delete xoGames[from];
    await sock.sendMessage(from, {
      text: buildFancyCard(
        '🤝',
        'اكس أو - انتهت اللعبة',
        `${renderXoBoard(game.board)}\n\n🤝 *تعادل!* اللوحة امتلأت من غير فايز.`
      ),
      mentions: [game.p1, game.p2],
    });
    return;
  }

  game.turn = mySide === 'p1' ? 'p2' : 'p1';
  await sendXoBoard(sock, from, game);
}

// ==== ⚔️ مبارزة 1 ضد 1 بنقاط حياة (HP) — أسئلة صعبة بدل الهجوم العادي + متجر أسلحة وسحر بمنتصف المعركة ====
// ==== 🎯 لعبة المشنقة (Hangman): تخمين حروف كلمة سرية قبل ما تخلص المحاولات — لعبة جماعية، أي حدا بالقروب يقدر يخمن حرف ====
const hangmanGames = {}; // { chatId: { word, category, guessed: Set, wrong: Set, maxWrong, lastActionAt, contributors: {userKey: count} } }
const HANGMAN_MAX_WRONG = 6;
const HANGMAN_STAGES = [
  '```\n  ┌───┐\n  │\n  │\n  │\n──┴──\n```',
  '```\n  ┌───┐\n  │   😐\n  │\n  │\n──┴──\n```',
  '```\n  ┌───┐\n  │   😐\n  │   │\n  │\n──┴──\n```',
  '```\n  ┌───┐\n  │   😟\n  │  /│\n  │\n──┴──\n```',
  '```\n  ┌───┐\n  │   😰\n  │  /│\\\n  │\n──┴──\n```',
  '```\n  ┌───┐\n  │   😰\n  │  /│\\\n  │  /\n──┴──\n```',
  '```\n  ┌───┐\n  │   💀\n  │  /│\\\n  │  / \\\n──┴──\n```',
];
const hangmanWordBank = {
  'حيوانات': ['اسد', 'نمر', 'فيل', 'زرافة', 'قرد', 'حصان', 'جمل', 'ثعلب', 'ذئب', 'ارنب', 'دب', 'نسر', 'بومة', 'حوت', 'دلفين', 'تمساح', 'ضبع', 'غزال'],
  'فواكه': ['تفاح', 'موز', 'عنب', 'برتقال', 'فراولة', 'اناناس', 'بطيخ', 'مانجو', 'كيوي', 'رمان', 'خوخ', 'مشمش', 'كرز', 'اجاص'],
  'دول': ['مصر', 'لبنان', 'سوريا', 'الاردن', 'السعودية', 'قطر', 'الكويت', 'عمان', 'تونس', 'المغرب', 'الجزائر', 'اليمن', 'العراق', 'فلسطين'],
  'مهن': ['طبيب', 'مهندس', 'معلم', 'طيار', 'نجار', 'حداد', 'خباز', 'محامي', 'ممرض', 'شرطي', 'طباخ', 'مصور', 'مزارع', 'صياد'],
  'ادوات': ['مطرقة', 'مفك', 'منشار', 'مفتاح', 'مقص', 'ابرة', 'مسطرة', 'فرشاة', 'ملعقة', 'سكين', 'ملقط'],
  'رياضات': ['كرة القدم', 'كرة السلة', 'السباحة', 'الجري', 'الملاكمة', 'التنس', 'الغولف', 'الكاراتيه'],
};

// ==== توحيد أشكال الألف المختلفة (أ إ آ) لحرف واحد، حتى ما يضيع اللاعب لو خمن "ا" بدل "أ" ====
function normalizeArabicChar(ch) {
  return ch.replace(/[أإآ]/g, 'ا');
}

function renderHangmanWord(word, guessedSet) {
  return word
    .split('')
    .map((ch) => (ch === ' ' ? '   ' : guessedSet.has(normalizeArabicChar(ch)) ? ch : '▫️'))
    .join(' ');
}

function isHangmanWordComplete(word, guessedSet) {
  return word.split('').every((ch) => ch === ' ' || guessedSet.has(normalizeArabicChar(ch)));
}

async function sendHangmanBoard(sock, from, game, extraText = '') {
  const wrongCount = game.wrong.size;
  const wrongLetters = wrongCount > 0 ? `❌ حروف غلط: ${[...game.wrong].join('  ')}\n\n` : '';
  await sock.sendMessage(from, {
    text: buildFancyCard(
      '🎯',
      'لعبة المشنقة',
      `${extraText}${HANGMAN_STAGES[wrongCount]}\n\n` +
        `📂 التصنيف: *${game.category}*\n` +
        `🔤 الكلمة: ${renderHangmanWord(game.word, game.guessed)}\n\n` +
        wrongLetters +
        `💔 محاولات متبقية: *${game.maxWrong - wrongCount}* / ${game.maxWrong}`,
      '📝 اكتب حرف عربي واحد للتخمين، أو .استسلام_مشنقة للاستسلام'
    ),
  });
}

const DUEL_MAX_HP = 10;
const DUEL_MAX_HEALS = 2;
const DUEL_ROUND_TIMEOUT_MS = 45 * 1000; // 45 ثانية للإجابة قبل ما يضيع دورك تلقائياً
const DUEL_ACTION_TIMEOUT_MS = 30 * 1000; // 30 ثانية لاختيار الحركة بعد ما تجاوب صح

// بنك أسئلة صعبة جداً خاص بالمبارزة (ثقافة عامة، رياضيات، ألغاز، منطق — كلها صعبة ومنوعة)
const duelQuestions = [
  // 🧬 علوم
  { q: 'شو اسم أصغر عظمة بجسم الإنسان؟', a: 'الركاب' },
  { q: 'كم عدد الكروموسومات عند الإنسان؟', a: '46' },
  { q: 'شو اسم العالم اللي اكتشف الجاذبية؟', a: 'نيوتن' },
  { q: 'شو اسم أكبر قمر لكوكب المشتري؟', a: 'جانيميد' },
  { q: 'شو اسم الغاز الأكثر وفرة بالغلاف الجوي للأرض؟', a: 'النيتروجين' },
  { q: 'كم عدد قلوب الأخطبوط؟', a: '3' },
  { q: 'شو اسم الوحدة اللي بتقاس فيها شدة الزلازل؟', a: 'ريختر' },
  { q: 'شو اسم العالم اللي وضع نظرية النسبية؟', a: 'اينشتاين' },
  { q: 'كم عدد عظام الجمجمة عند الإنسان البالغ؟', a: '22' },
  { q: 'شو اسم أصغر جزيء بالماء؟', a: 'H2O' },
  { q: 'شو اسم الغدة اللي بتفرز الأنسولين؟', a: 'البنكرياس' },
  { q: 'كم عدد حجرات القلب البشري؟', a: '4' },
  { q: 'شو اسم العالم اللي اكتشف البنسلين؟', a: 'فليمنغ' },
  { q: 'شو أسرع حيوان بحري بالعالم؟', a: 'سمك أبو شراع' },
  { q: 'كم عدد الحواس الأساسية عند الإنسان؟', a: '5' },
  { q: 'شو اسم غاز التخدير الأول المستخدم بالطب؟', a: 'الكلوروفورم' },

  // 🌍 جغرافيا
  { q: 'شو أطول سلسلة جبال بالعالم؟', a: 'الأنديز' },
  { q: 'شو اسم أكبر جزيرة بالعالم؟', a: 'غرينلاند' },
  { q: 'كم عدد الدول اللي تحدها روسيا برياً؟', a: '14' },
  { q: 'شو اسم أطول نهر بقارة آسيا؟', a: 'اليانغتسي' },
  { q: 'شو اسم أعمق نقطة بمحيطات الأرض؟', a: 'خندق ماريانا' },
  { q: 'شو اسم أكبر بحيرة بالعالم من ناحية المساحة؟', a: 'بحر قزوين' },
  { q: 'شو عاصمة النمسا؟', a: 'فيينا' },
  { q: 'شو عاصمة أستراليا؟', a: 'كانبيرا' },
  { q: 'شو عاصمة كندا؟', a: 'أوتاوا' },
  { q: 'شو أصغر قارة بالعالم من ناحية المساحة؟', a: 'أستراليا' },
  { q: 'شو اسم المضيق اللي بيفصل آسيا عن أفريقيا؟', a: 'باب المندب' },
  { q: 'شو اسم أكبر شبه جزيرة بالعالم؟', a: 'شبه الجزيرة العربية' },
  { q: 'كم عدد الولايات المتحدة الأمريكية؟', a: '50' },
  { q: 'شو عاصمة سويسرا؟', a: 'برن' },
  { q: 'شو اسم أطول جدار بالتاريخ؟', a: 'سور الصين العظيم' },

  // 📜 تاريخ
  { q: 'شو اسم أول خليفة أموي؟', a: 'معاوية' },
  { q: 'كم سنة استمرت الحرب العالمية الثانية؟', a: '6' },
  { q: 'شو اسم أول رائد فضاء وصل للقمر؟', a: 'ارمسترونغ' },
  { q: 'شو اسم أول خليفة عباسي؟', a: 'أبو العباس السفاح' },
  { q: 'بأي سنة سقطت الأندلس؟', a: '1492' },
  { q: 'شو اسم القائد اللي فتح مصر إسلامياً؟', a: 'عمرو بن العاص' },
  { q: 'بأي سنة انتهت الحرب العالمية الأولى؟', a: '1918' },
  { q: 'شو اسم أول رئيس أمريكي؟', a: 'جورج واشنطن' },
  { q: 'شو اسم الإمبراطورية اللي حكمت أغلب أوروبا زمن نابليون؟', a: 'الإمبراطورية الفرنسية' },
  { q: 'بأي سنة سقطت جدار برلين؟', a: '1989' },
  { q: 'شو اسم أول جامعة بالعالم؟', a: 'جامعة القرويين' },

  // ➗ رياضيات ومنطق
  { q: 'كم يساوي جذر 169؟', a: '13' },
  { q: 'شو ناتج 17 × 13؟', a: '221' },
  { q: 'شو ناتج 15% من 480؟', a: '72' },
  { q: 'كم عدد أضلاع الشكل التساعي؟', a: '9' },
  { q: 'شو ناتج (8×8) − (6×6)؟', a: '28' },
  { q: 'ثلاثة أرقام متتالية مجموعها 51، شو أصغرهم؟', a: '16' },
  { q: 'كم يساوي 2 أس 10؟', a: '1024' },
  { q: 'شو ناتج جمع أول 10 أعداد صحيحة (1 لـ10)؟', a: '55' },
  { q: 'شو ناتج 9 تربيع ناقص 5 تربيع؟', a: '56' },
  { q: 'كم عدد أضلاع الشكل السداسي عشر؟', a: '16' },
  { q: 'شو ناتج قسمة 144 على 12؟', a: '12' },
  { q: 'أنا شيء كل ما أخذوا مني كبرت، شو أنا؟', a: 'الحفرة' },
  { q: 'شو الشيء اللي كلما نقص زاد؟', a: 'العمر' },

  // 🚀 فضاء وفلك
  { q: 'شو اسم أقرب نجم للأرض بعد الشمس؟', a: 'الفا سنتوري' },
  { q: 'كم يوم بتاخد المركبة عادة عشان توصل المريخ؟', a: '7 أشهر تقريباً' },
  { q: 'شو اسم أول قمر صناعي أطلقته البشرية؟', a: 'سبوتنيك' },
  { q: 'شو اسم المجرة اللي فيها الأرض؟', a: 'درب التبانة' },
  { q: 'شو أصغر كوكب بالمجموعة الشمسية؟', a: 'عطارد' },
  { q: 'كم سنة ضوئية تقريباً قطر مجرة درب التبانة؟', a: '100000' },
  { q: 'شو اسم أول امرأة وصلت الفضاء؟', a: 'فالنتينا تيريشكوفا' },

  // 🏆 رياضة
  { q: 'كم مرة فازت البرازيل بكأس العالم؟', a: '5' },
  { q: 'شو اسم أول بطولة كأس عالم بكرة القدم وبأي بلد أقيمت؟', a: 'الأوروغواي' },
  { q: 'كم لاعب بفريق كرة السلة داخل الملعب من كل جهة؟', a: '5' },
  { q: 'شو اسم الرياضة اللي بتستخدم فيها كلمة "تشيك مات"؟', a: 'الشطرنج' },
  { q: 'كل كم سنة بتقام الألعاب الأولمبية الصيفية؟', a: '4' },
  { q: 'شو اسم أشهر سباق دراجات هوائية بالعالم؟', a: 'تور دو فرانس' },

  // 📖 أدب ومعرفة عامة
  { q: 'شو اسم أشهر رواية لنجيب محفوظ عن حارة بمصر؟', a: 'زقاق المدق' },
  { q: 'شو اسم أول لغة برمجة بالعالم؟', a: 'فورتران' },
  { q: 'شو اسم العملة الرسمية لليابان؟', a: 'ين' },
  { q: 'شو اسم أول متصفح إنترنت بالعالم؟', a: 'وورلد وايد ويب' },
  { q: 'شو اسم مخترع الهاتف؟', a: 'الكسندر غراهام بيل' },
  { q: 'شو اسم أول شركة أطلقت هاتف ذكي بالعالم؟', a: 'ابل' },
  { q: 'كم عدد حروف اللغة العربية؟', a: '28' },
  { q: 'شو اسم أشهر لوحة لدافنشي فيها امرأة بابتسامة غامضة؟', a: 'الموناليزا' },
];

// عناصر متجر المعركة: أسلحة وسحر تشترى بالذهب المكتسب من الإجابات الصحيحة
const duelShopItems = [
  { id: 'سيف', name: '🗡️ سيف حاد', price: 20, type: 'attack', value: 1, desc: '+1 ضرر بهجمتك الجاية' },
  { id: 'رمح', name: '🔱 رمح مسموم', price: 35, type: 'attack', value: 2, desc: '+2 ضرر بهجمتك الجاية' },
  { id: 'كرة_نارية', name: '🔥 كرة نارية', price: 55, type: 'attack', value: 3, desc: '+3 ضرر بهجمتك الجاية (قوية جداً)' },
  { id: 'صاعقة', name: '⚡ صاعقة إلهية', price: 75, type: 'attack', value: 4, desc: '+4 ضرر بهجمتك الجاية (أقوى سلاح هجومي عادي)' },
  { id: 'سهم_الاختراق', name: '🏹 سهم الاختراق', price: 45, type: 'pierceattack', value: 2, desc: '+2 ضرر، وبيخترق أي درع أو تفادي (ما ينصد أبداً)' },
  { id: 'ضربة_مزدوجة', name: '🗡️🗡️ ضربة الفارس المزدوجة', price: 65, type: 'doubleattack', desc: 'هجمتك الجاية بتصيب مرتين متتاليتين (تضاعف الضرر تقريباً)' },
  { id: 'لعنة_الضعف', name: '💀 لعنة الضعف', price: 40, type: 'curse', desc: 'تلعن خصمك: هجمته الجاية عليك بتضعف للنص' },
  { id: 'درع', name: '🛡️ درع سحري', price: 25, type: 'shield', desc: 'يصد نص ضرر أول هجمة توصلك فوراً' },
  { id: 'تميمة_الحماية_الكاملة', name: '🧿 تميمة الحماية الكاملة', price: 50, type: 'fullshield', desc: 'يصد أي هجمة جاية بالكامل 100% (أقوى من الدرع العادي)' },
  { id: 'تعويذة_صد', name: '🌀 تعويذة الصد', price: 45, type: 'dodge', desc: 'تتفادى الهجمة الجاية بالكامل (تفادي تام)' },
  { id: 'جرعة', name: '🧪 جرعة شفاء', price: 20, type: 'heal', value: 2, desc: '+2 نقطة حياة فوراً' },
  { id: 'جرعة_كبرى', name: '💊 جرعة شفاء كبرى', price: 40, type: 'heal', value: 4, desc: '+4 نقطة حياة فوراً' },
  { id: 'اكسير_الخلود', name: '✨ إكسير الخلود', price: 60, type: 'heal', value: 6, desc: '+6 نقطة حياة فوراً (أقوى جرعة شفاء بالمتجر)' },
  { id: 'خاتم_الإحياء', name: '💍 خاتم الإحياء', price: 70, type: 'revive', desc: 'لو هجمة قاتلة توصلك، بتنجو بنقطة حياة واحدة بدل ما تخسر (مرة وحدة)' },
  { id: 'سرقة', name: '🕵️ خنجر السرقة', price: 15, type: 'steal', value: 15, desc: 'تسرق 15 ذهب من خصمك فوراً' },
  { id: 'سرقة_كبرى', name: '🕵️💰 سرقة الأساطير', price: 30, type: 'steal', value: 35, desc: 'تسرق 35 ذهب من خصمك فوراً' },
  { id: 'شحنة_ذهب', name: '⚡ شحنة ذهب', price: 25, type: 'goldboost', value: 30, desc: '+30 ذهب فوري لحسابك' },
  { id: 'كنز_ضخم', name: '💰 الكنز الضخم', price: 55, type: 'goldboost', value: 70, desc: '+70 ذهب فوري لحسابك' },
  { id: 'تاج_الأسطورة', name: '👑 تاج الأسطورة', price: 110, type: 'legendary', desc: 'أفخم غرض بالمتجر: شفاء كامل فوري + حماية كاملة من الهجمة الجاية' },
];
function findDuelItem(id) {
  return duelShopItems.find((it) => it.id === (id || '').trim()) || null;
}
function duelPickQuestion() {
  return duelQuestions[Math.floor(Math.random() * duelQuestions.length)];
}

// بيرسم شريط حياة بصري بقلوب ❤️/🖤 حسب النسبة من الحد الأقصى
function renderHpBar(hp, max = DUEL_MAX_HP, size = 10) {
  const safeHp = Math.max(0, Math.min(max, hp));
  const filled = Math.round((safeHp / max) * size);
  return '❤️'.repeat(filled) + '🖤'.repeat(size - filled);
}

// بيرتب المتجر مقسّم لفئات (أسلحة / دفاعية / علاجية / خاصة / أسطورية) شكل أوضح وأجمل
function renderDuelShop(duel, mySlot) {
  const categories = [
    { title: '⚔️ أسلحة هجومية', types: ['attack', 'pierceattack', 'doubleattack', 'curse'] },
    { title: '🛡️ دفاعية', types: ['shield', 'fullshield', 'dodge'] },
    { title: '💚 علاجية', types: ['heal', 'revive'] },
    { title: '🕵️ خاصة واقتصادية', types: ['steal', 'goldboost'] },
    { title: '👑 أسطورية', types: ['legendary'] },
  ];
  let out = '';
  for (const cat of categories) {
    const items = duelShopItems.filter((it) => cat.types.includes(it.type));
    if (!items.length) continue;
    out += `\n*${cat.title}*\n`;
    out += items.map((it) => `  • \`${it.id}\` — ${it.name} (${it.price} 🪙)\n     ↳ ${it.desc}`).join('\n') + '\n';
  }
  return out;
}

// بيبعت سؤال الجولة الحالية لمين إله الدور، وبيرتب مؤقت 45 ثانية قبل ما يضيع الدور تلقائياً
async function announceDuelRound(sock, from) {
  const duel = duels[from];
  if (!duel) return;
  const mySlot = duel.turn;
  const oppSlot = mySlot === 'p1' ? 'p2' : 'p1';
  const myJid = duel[mySlot];
  const oppJid = duel[oppSlot];
  duel.actionReady[mySlot] = false;
  const picked = duelPickQuestion();
  duel.pendingQuestion = { q: picked.q, a: picked.a.toLowerCase().trim() };
  duel.roundId = (duel.roundId || 0) + 1;
  const myRoundId = duel.roundId;

  await sock.sendMessage(from, {
    text:
      `┏━━━⚔️ *دور @${myJid.split('@')[0]}* ⚔️━━━┓\n\n` +
      `👤 @${duel.p1.split('@')[0]}\n${renderHpBar(duel.hp.p1)}  ${duel.hp.p1}/${DUEL_MAX_HP}\n` +
      `👤 @${duel.p2.split('@')[0]}\n${renderHpBar(duel.hp.p2)}  ${duel.hp.p2}/${DUEL_MAX_HP}\n\n` +
      `🪙 الذهب: @${duel.p1.split('@')[0]} ${duel.gold.p1} │ @${duel.p2.split('@')[0]} ${duel.gold.p2}\n\n` +
      `❓ *سؤال صعب:* ${picked.q}\n\n` +
      `✨ جاوب صح حتى تفتح حركة (هجوم/دفاع/شفاء)!\n` +
      `🛒 .متجر_المعركة لتشوف الأسلحة والسحر المتاحة.\n⏰ عندك 45 ثانية تجاوب.`,
    mentions: [duel.p1, duel.p2],
  });

  setTimeout(async () => {
    const current = duels[from];
    if (!current || current.roundId !== myRoundId || !current.pendingQuestion) return; // الجولة خلصت أو انجاوبت أصلاً
    current.pendingQuestion = null;
    await sock.sendMessage(from, {
      text: `⏰ ✦ خلص وقت @${myJid.split('@')[0]}! ضاع الدور بدون جواب. الإجابة كانت: *${picked.a}*`,
      mentions: [myJid],
    });
    current.turn = oppSlot;
    await announceDuelRound(sock, from);
  }, DUEL_ROUND_TIMEOUT_MS);
}

// بعد إجابة صحيحة، بيرتب مؤقت 30 ثانية لاختيار الحركة (هجوم/دفاع/شفاء) قبل ما تضيع الفرصة
function scheduleDuelActionTimeout(sock, from, mySlot, myJid, oppSlot) {
  const duel = duels[from];
  if (!duel) return;
  const myRoundId = duel.roundId;
  setTimeout(async () => {
    const current = duels[from];
    if (!current || current.roundId !== myRoundId || !current.actionReady[mySlot]) return;
    current.actionReady[mySlot] = false;
    await sock.sendMessage(from, {
      text: `⏰ ✦ خلص وقت اختيار الحركة! ضاع دور @${myJid.split('@')[0]} بدون ما يستخدمها.`,
      mentions: [myJid],
    });
    current.turn = oppSlot;
    await announceDuelRound(sock, from);
  }, DUEL_ACTION_TIMEOUT_MS);
}

// بتفحص إذا خصم الجولة الحالية مات، وبتوزع الجائزة وتقفل المبارزة لو خلصت
async function checkDuelEnd(sock, from, myJid, oppJid, oppSlot) {
  const duel = duels[from];
  if (!duel) return true;
  if (duel.hp[oppSlot] <= 0) {
    delete duels[from];
    const newTotal = addPoints(myJid, 25);
    await sock.sendMessage(from, {
      text:
        `💀☠️ ✦ *انتهت المبارزة!* ✦ ☠️💀\n@${oppJid.split('@')[0]} قُضي عليه!\n\n` +
        `🏆👑 الفائز: @${myJid.split('@')[0]} (+25 نقطة، المجموع: ${newTotal})`,
      mentions: [myJid, oppJid],
    });
    return true;
  }
  return false;
}

// ==== 💀 حرب جماعية (Battle Royale) بالقروب — انضمام بمهلة، بعدين هجوم حر بكولداون، آخر ناجي بيفوز ====
const wars = {}; // { groupId: { phase: 'joining'|'active', participants: { key: { jid, hp, warnings, lastAttackAt } }, joinEndsAt, startedBy } }

// ==== 🏰 برج التحدي الأسطوري: تسلق فردي طابق فوق طابق، وحوش أقوى كل ما ارتفعت، خطر خسارة كل الغنيمة لو مت ====
const towerRuns = {}; // { userKey: { floor, hp, maxHp, loot } }
const TOWER_BASE_HP = 30;

function towerMonsterFor(floor) {
  // كل طابق الوحش أقوى: حياة وضرر بيزيدوا تدريجياً
  const hp = 6 + floor * 3;
  const minDmg = 2 + Math.floor(floor / 2);
  const maxDmg = 4 + Math.floor(floor / 2);
  const names = ['🧟 زومبي', '👹 غول', '🐺 ذئب مسحور', '💀 هيكل عظمي', '🧙 ساحر شرير', '🐉 تنين صغير', '👻 شبح', '🕷️ عنكبوت عملاق'];
  const name = floor % 10 === 0 ? '🐲 تنين البرج (زعيم!)' : names[floor % names.length];
  return { name, hp, minDmg, maxDmg };
}

// ==== 🎡 عجلة الحظ الملكية: رهان بنقاطك العادية، مضاعفات متنوعة وجائزة كبرى نادرة ====
const wheelSegments = [
  { mult: 0, label: '💀 خسارة كاملة', weight: 30 },
  { mult: 0.5, label: '📉 نص الرهان بس', weight: 25 },
  { mult: 1, label: '➖ تعادل', weight: 18 },
  { mult: 1.5, label: '📈 ×1.5', weight: 15 },
  { mult: 2, label: '🎉 ×2', weight: 7 },
  { mult: 3, label: '🔥 ×3', weight: 3 },
  { mult: 10, label: '👑 الجائزة الكبرى ×10!', weight: 2 },
];
function spinWheel() {
  const totalWeight = wheelSegments.reduce((s, seg) => s + seg.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const seg of wheelSegments) {
    if (roll < seg.weight) return seg;
    roll -= seg.weight;
  }
  return wheelSegments[0];
}
const WAR_JOIN_WINDOW_MS = 60 * 1000; // دقيقة للانضمام
const WAR_MAX_HP = 10;
const WAR_ATTACK_COOLDOWN_MS = 15 * 1000; // كولداون 15 ثانية بين كل هجمة

const triviaQuestions = [
  { q: 'شو عاصمة فرنسا؟', a: 'باريس' },
  { q: 'كم عدد قارات العالم؟', a: '7' },
  { q: 'شو أكبر محيط بالعالم؟', a: 'الهادئ' },
  { q: 'شو اسم أطول نهر بالعالم؟', a: 'النيل' },
  { q: 'كم عدد أيام السنة الكبيسة؟', a: '366' },
  { q: 'شو عاصمة اليابان؟', a: 'طوكيو' },
  { q: 'كم عدد ألوان قوس قزح؟', a: '7' },
  { q: 'شو اسم أكبر صحراء بالعالم؟', a: 'الصحراء الكبرى' },
  { q: 'شو عاصمة الجزائر؟', a: 'الجزائر' },
  { q: 'كم عدد أرجل العنكبوت؟', a: '8' },
  { q: 'شو عاصمة مصر؟', a: 'القاهرة' },
  { q: 'شو عاصمة المغرب؟', a: 'الرباط' },
  { q: 'شو عاصمة تونس؟', a: 'تونس' },
  { q: 'شو عاصمة السعودية؟', a: 'الرياض' },
  { q: 'شو عاصمة الإمارات؟', a: 'أبوظبي' },
  { q: 'شو أطول جبل بالعالم (فوق سطح البحر)؟', a: 'إفرست' },
  { q: 'كم عدد عظام جسم الإنسان البالغ؟', a: '206' },
  { q: 'شو أسرع حيوان بري بالعالم؟', a: 'الفهد' },
  { q: 'كم عدد أوتار الغيتار العادي؟', a: '6' },
  { q: 'شو الكوكب الأقرب للشمس؟', a: 'عطارد' },
  { q: 'كم عدد كواكب المجموعة الشمسية؟', a: '8' },
  { q: 'شو أكبر كوكب بالمجموعة الشمسية؟', a: 'المشتري' },
  { q: 'شو الغاز اللي بيتنفسه الإنسان؟', a: 'الأكسجين' },
  { q: 'كم عدد أسنان الإنسان البالغ عادة؟', a: '32' },
  { q: 'شو أطول نهر بأفريقيا؟', a: 'النيل' },
  { q: 'كم لون بالعلم الجزائري؟', a: '2' },
  { q: 'شو اسم أصغر دولة بالعالم من ناحية المساحة؟', a: 'الفاتيكان' },
  { q: 'كم عدد اللاعبين بفريق كرة القدم داخل الملعب؟', a: '11' },
  { q: 'شو أكبر قارة بالعالم من ناحية المساحة؟', a: 'آسيا' },
  { q: 'كم دقيقة بالساعة؟', a: '60' },
  { q: 'شو اسم العملة الرسمية باليابان؟', a: 'الين' },
  { q: 'كم عدد حروف اللغة العربية؟', a: '28' },
];

const quotes = [
  'النجاح هو الانتقال من فشل إلى فشل دون فقدان الحماس.',
  'أفضل طريقة للتنبؤ بالمستقبل هي صنعه.',
  'لا تنتظر الفرصة، اصنعها.',
  'العلم بلا عمل كالشجر بلا ثمر.',
  'من جد وجد، ومن زرع حصد.',
  'الوقت كالسيف إن لم تقطعه قطعك.',
  'الصبر مفتاح الفرج.',
  'اطلب العلم من المهد إلى اللحد.',
  'كن التغيير الذي تريد أن تراه بالعالم.',
  'العقل السليم في الجسم السليم.',
];

const speedWords = ['برتقال', 'حاسوب', 'شمس', 'قمر', 'كتاب', 'مدرسة', 'سيارة', 'بحر', 'جبل', 'نجمة'];
// كلمات أصعب وأطول للسباق السريع (تصعيب اللعبة)
const speedWordsHard = ['استقلالية', 'مسؤولية', 'اكتشافات', 'مواصلات', 'استراتيجية', 'تكنولوجيا', 'اقتصادية', 'ديمقراطية', 'مستشفيات', 'مغامرات'];

// ==== 🧮 مولّد أسئلة حساب أصعب: أرقام أكبر + عملية القسمة ====
function generateMathChallenge() {
  const operators = ['+', '-', '×', '÷'];
  const op = operators[Math.floor(Math.random() * operators.length)];
  let num1, num2, answer;
  if (op === '×') {
    num1 = Math.floor(Math.random() * 20) + 2; // 2-21
    num2 = Math.floor(Math.random() * 20) + 2;
    answer = num1 * num2;
  } else if (op === '÷') {
    num2 = Math.floor(Math.random() * 11) + 2; // 2-12
    const result = Math.floor(Math.random() * 20) + 2; // 2-21
    num1 = num2 * result; // نتأكد إنها قسمة مضبوطة (بدون كسور)
    answer = result;
  } else {
    num1 = Math.floor(Math.random() * 100) + 1; // 1-100 (أصعب من قبل)
    num2 = Math.floor(Math.random() * 100) + 1;
    answer = op === '+' ? num1 + num2 : num1 - num2;
  }
  return { num1, num2, op, answer: String(answer) };
}
const speedGames = {}; // { chatId: { word } }

const mathGames = {}; // { chatId: { answer } }

const scrambleWords = ['حاسوب', 'مدرسة', 'برتقال', 'سيارة', 'مكتبة', 'طائرة', 'زرافة', 'شمس', 'قمر', 'بحيرة'];
const scrambleGames = {}; // { chatId: { word } }

function shuffleWord(word) {
  const letters = word.split('');
  let shuffled;
  do {
    shuffled = [...letters].sort(() => Math.random() - 0.5).join('');
  } while (shuffled === word);
  return shuffled;
}

// ==== 🧩 لعبة الألغاز ====
const riddles = [
  { q: 'شي كل ما أخذت منه كبر، شو هو؟', a: 'الحفرة' },
  { q: 'له أسنان ولا يعض، شو هو؟', a: 'المشط' },
  { q: 'يمشي بلا أرجل ويسبح بلا زعانف، شو هو؟', a: 'الظل' },
  { q: 'كلما زاد نقص، شو هو؟', a: 'العمر' },
  { q: 'بيت بلا أبواب ولا شبابيك، شو هو؟', a: 'البيضة' },
  { q: 'شي تراه بالليل ولا تراه بالنهار، شو هو؟', a: 'النجوم' },
  { q: 'له عين ولا يبصر، شو هو؟', a: 'الإبرة' },
  { q: 'يدخل الماء ولا يبتل، شو هو؟', a: 'الضوء' },
  { q: 'يوجد بالقلب حرفان فقط، شو هو الحرف الناقص من "قلب" إذا حذفنا الباء؟', a: 'قل' },
  { q: 'شي أبيض بيدخل أصفر ويطلع أحمر، شو هو؟', a: 'البيضة المسلوقة' },
  { q: 'كأس مليان ماء بس ما بينسكب لو قلبته، شو هو؟', a: 'الثلج' },
  { q: 'له رجل واحدة ويقف طول اليوم، شو هو؟', a: 'الفطر' },
  { q: 'شي يكسر بدون ما تلمسه، شو هو؟', a: 'الوعد' },
  { q: 'كل ما غسلته صار أوسخ، شو هو؟', a: 'الماء' },
  { q: 'له مدينة بلا بيوت وغابة بلا أشجار وبحر بلا ماء، شو هو؟', a: 'الخريطة' },
];
const riddleGames = {}; // { chatId: { answer } }

// ==== ✅❌ لعبة صح أو خطأ ====
const trueFalseStatements = [
  { s: 'الشمس أكبر من الأرض بكتير', a: 'صح' },
  { s: 'القمر ينتج ضوءه الخاص', a: 'خطأ' },
  { s: 'الفيل هو أكبر حيوان بري بالعالم', a: 'صح' },
  { s: 'الإنسان عنده 4 رئات', a: 'خطأ' },
  { s: 'الماء يتجمد عند صفر درجة مئوية', a: 'صح' },
  { s: 'العنكبوت حشرة', a: 'خطأ' },
  { s: 'مصر فيها أهرامات الجيزة', a: 'صح' },
  { s: 'الضوء أسرع من الصوت', a: 'صح' },
  { s: 'القلب البشري له غرفتان فقط', a: 'خطأ' },
  { s: 'اليابان جزيرة', a: 'صح' },
  { s: 'الزرافة أطول حيوان بري بالعالم', a: 'صح' },
  { s: 'النمل من الثدييات', a: 'خطأ' },
  { s: 'خط الاستواء يمر من الجزائر', a: 'خطأ' },
  { s: 'المثلث له 3 أضلاع', a: 'صح' },
  { s: 'الموز نوع من الأعشاب مش الأشجار', a: 'صح' },
];
const trueFalseGames = {}; // { chatId: { answer } }

// ==== 🚩 لعبة تخمين الدولة من العلم ====
const flagCountries = [
  { flag: '🇩🇿', name: 'الجزائر' },
  { flag: '🇲🇦', name: 'المغرب' },
  { flag: '🇹🇳', name: 'تونس' },
  { flag: '🇪🇬', name: 'مصر' },
  { flag: '🇸🇦', name: 'السعودية' },
  { flag: '🇦🇪', name: 'الإمارات' },
  { flag: '🇯🇴', name: 'الأردن' },
  { flag: '🇱🇧', name: 'لبنان' },
  { flag: '🇮🇶', name: 'العراق' },
  { flag: '🇸🇾', name: 'سوريا' },
  { flag: '🇫🇷', name: 'فرنسا' },
  { flag: '🇩🇪', name: 'ألمانيا' },
  { flag: '🇮🇹', name: 'إيطاليا' },
  { flag: '🇪🇸', name: 'إسبانيا' },
  { flag: '🇬🇧', name: 'بريطانيا' },
  { flag: '🇺🇸', name: 'أمريكا' },
  { flag: '🇨🇦', name: 'كندا' },
  { flag: '🇧🇷', name: 'البرازيل' },
  { flag: '🇯🇵', name: 'اليابان' },
  { flag: '🇨🇳', name: 'الصين' },
  { flag: '🇹🇷', name: 'تركيا' },
  { flag: '🇷🇺', name: 'روسيا' },
  { flag: '🇰🇷', name: 'كوريا الجنوبية' },
  { flag: '🇮🇳', name: 'الهند' },
];
const flagGames = {}; // { chatId: { name } }

// ==== 📜 لعبة إكمال المثل ====
const proverbs = [
  { half: 'اللي فات مات، و', answer: 'اللي جاي بعده آت' },
  { half: 'يد وحدة ما', answer: 'بتصفق' },
  { half: 'القرد بعين أمه', answer: 'غزال' },
  { half: 'الطيور على', answer: 'أشكالها تقع' },
  { half: 'اللي ما يعرف الصقر', answer: 'يشويه' },
  { half: 'رمتني بدائها و', answer: 'انسلت' },
  { half: 'كل ممنوع', answer: 'مرغوب' },
  { half: 'اللي بيته من زجاج', answer: 'ما يحجر الناس بالحجر' },
  { half: 'ادفنوني بحفرة', answer: 'واحدة' },
  { half: 'اللي إيده بالماء', answer: 'مش متل اللي إيده بالنار' },
  { half: 'العين ما', answer: 'بتعلى عن الحاجب' },
  { half: 'إن كنت ريح', answer: 'فقد لاقيت إعصار' },
  { half: 'الجار قبل', answer: 'الدار' },
  { half: 'الصبر مفتاح', answer: 'الفرج' },
  { half: 'مكتوب على باب الحارة', answer: 'ما ينفع الحذر من القدر' },
];
const proverbGames = {}; // { chatId: { answer } }

// ==== 🧠 لعبة خمن الشخصية ====
const famousFigures = [
  { clue: 'عالم فيزيائي طوّر نظرية النسبية، شعره مجعد وطويل، أصله ألماني.', a: 'اينشتاين' },
  { clue: 'عالم مسلم يُلقب بأبي الجبر، له كتاب مشهور بالجبر والمقابلة.', a: 'الخوارزمي' },
  { clue: 'رسام إيطالي رسم لوحة الموناليزا وكان مخترع أيضاً.', a: 'دافنشي' },
  { clue: 'عالم مسلم رائد بالطب، ألّف كتاب القانون بالطب.', a: 'ابن سينا' },
  { clue: 'مخترع أمريكي اخترع المصباح الكهربائي.', a: 'اديسون' },
  { clue: 'عالم طبيعي وضع نظرية التطور والانتخاب الطبيعي.', a: 'داروين' },
  { clue: 'عالمة فيزياء وكيمياء بولندية، أول امرأة تفوز بجائزة نوبل.', a: 'ماري كوري' },
  { clue: 'قائد عسكري ومؤسس امبراطورية إسلامية امتدت من الأندلس للهند بالقرن السابع الميلادي.', a: 'عمر بن الخطاب' },
  { clue: 'مخترع الهاتف الأول المعترف فيه رسمياً.', a: 'جراهام بيل' },
  { clue: 'عالم فلك إيطالي أكد إن الأرض تدور حول الشمس وواجه محاكمة بسبب ذلك.', a: 'غاليليو' },
];
const figureGames = {}; // { chatId: { answer } }

// ==== ✏️ لعبة الكلمة الناقصة ====
const fillBlanks = [
  { sentence: 'الشمس تشرق من ___ وتغرب من الغرب', a: 'الشرق' },
  { sentence: 'السمكة تعيش في ___', a: 'الماء' },
  { sentence: 'العسل تنتجه ___', a: 'النحلة' },
  { sentence: 'القمر يدور حول ___', a: 'الأرض' },
  { sentence: 'اللغة العربية لها ___ حرف', a: '28' },
  { sentence: 'أكبر عضلة بجسم الإنسان هي ___', a: 'الفخذ' },
  { sentence: 'الجمل يخزن الماء في ___', a: 'السنام' },
  { sentence: 'أسرع طائر بالعالم هو ___', a: 'الشاهين' },
  { sentence: 'ثمرة الزيتون يُستخرج منها ___', a: 'زيت' },
  { sentence: 'أكبر محيط بالعالم هو المحيط ___', a: 'الهادئ' },
];
const blankGames = {}; // { chatId: { answer } }

// ==== 🔠 لعبة التصنيف: فئة + حرف، أول واحد يكتب كلمة صح ياخد النقاط ====
const categories = ['حيوان', 'بلد', 'فاكهة', 'خضار', 'مهنة', 'لون', 'مدينة عربية', 'رياضة', 'ماركة سيارة', 'اسم ولد', 'اسم بنت'];
const arabicLetters = ['أ', 'ب', 'ت', 'ج', 'ح', 'د', 'ر', 'س', 'ش', 'ص', 'ع', 'ف', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي'];
const categoryGames = {}; // { chatId: { category, letter } }

// ================================================
// 💎 لعبة "صراحة" — أسئلة صراحة بالدور، بشكل فخم وزخرفي
// ================================================

// ==== 📚 بنك أسئلة الصراحة — يتحمّل من ملف خارجي (لو موجود)، وإلا يستخدم قائمة احتياطية مصغّرة ====
const SINCERITY_FILE = '/data/data/com.termux/files/home/mybot/sincerity_questions.json';
let sincerityQuestions = [
  'مين أقرب حد ليك الفترة دي؟',
  'أكتر حاجة بتفخر بيها في نفسك؟',
  'إيه أصعب قرار اتخذته في حياتك؟',
  'بتحب بعقلك ولا بقلبك؟',
  'إيه الحلم اللي خايف تقوله لأي حد؟',
  'لو قدرت تغير حاجة في نفسك هتغير إيه؟',
  'إيه أحلى ذكرى من طفولتك؟',
  'مين الشخص اللي بيصدق فيك أكتر من نفسك؟',
  'إيه أكتر حاجة بتخليك سعيد؟',
  'لو حياتك اتحولت لفيلم هيبقى نوعه إيه؟',
];
try {
  if (fs.existsSync(SINCERITY_FILE)) {
    const loadedQuestions = JSON.parse(fs.readFileSync(SINCERITY_FILE, 'utf8'));
    if (Array.isArray(loadedQuestions) && loadedQuestions.length > 0) {
      sincerityQuestions = loadedQuestions;
    }
  } else {
    console.log(`ℹ️ ملف أسئلة الصراحة (${SINCERITY_FILE}) مش موجود، عم أستخدم قائمة احتياطية مصغّرة. ضيف الملف عشان تفعّل البنك الكامل.`);
  }
} catch (e) {
  console.log('⚠️ ما قدرت أحمل ملف أسئلة الصراحة، عم أستخدم قائمة احتياطية:', e.message);
}

// ==== 🎮 حالة لعبة الصراحة بالذاكرة ====
// { chatId: { players: [jid...], turn: index, used: Set<int>, active: bool, hostSender } }
const sincerityGames = {};

// ==== 🎲 يختار سؤال جديد ما اتسألش قبل كده بنفس الجولة (وبيعيد التدوير لو خلصت كل الأسئلة) ====
function pickSincerityQuestion(game) {
  if (game.used.size >= sincerityQuestions.length) game.used.clear();
  let idx;
  do {
    idx = Math.floor(Math.random() * sincerityQuestions.length);
  } while (game.used.has(idx));
  game.used.add(idx);
  return idx;
}

// ==== 🖼️ يبني رسالة الدور الحالي بشكل فخم وزخرفي ====
function buildSincerityTurnMessage(game) {
  const playerJid = game.players[game.turn];
  const qIndex = pickSincerityQuestion(game);
  const question = sincerityQuestions[qIndex];
  return {
    text:
      `┏━━━❖ 💎 *جولة صراحة جديدة* 💎 ❖━━━┓\n\n` +
      `🎙️ الدور على: @${playerJid.split('@')[0]}\n` +
      `👥 عدد اللاعبين: ${game.players.length}\n\n` +
      `❝ ${question} ❞\n\n` +
      `┗━━━━━━━━━━━━━━━━━━━━━━━┛\n` +
      `✍️ أي رد منك يُحسب إجابة صراحة (+8 نقاط 🏅)\n` +
      `⏭️ الأدمن يقدر يتخطى الدور بـ .تخطي_صراحة`,
    mentions: [playerJid],
  };
}

// ==== ➡️ ينقل الدور للاعب التالي ويرسل سؤال جديد ====
async function advanceSincerityTurn(sock, from) {
  const game = sincerityGames[from];
  if (!game) return;
  if (game.players.length < 2) {
    await sock.sendMessage(from, {
      text: '🏁 ✦ *انتهت اللعبة* ✦\nما تبقاش عدد كافي من اللاعبين (أقل من 2).',
    });
    delete sincerityGames[from];
    return;
  }
  game.turn = (game.turn + 1) % game.players.length;
  await sock.sendMessage(from, buildSincerityTurnMessage(game));
}

// ==== 🎉 وضع الفعالية: ألعاب متتالية تلقائياً بدون ما تكتب أمر كل مرة ====
const activeEvents = {}; // { chatId: true } — القروبات/الشخاص اللي فعّلوا الفعالية

// ==== ⏰ مؤقت 60 ثانية عام لأي لعبة: لو ما حدا جاوب صح، نكشف الإجابة تلقائياً ====
function scheduleAnswerTimeout(sock, from, gameStore, revealFn, seconds = 60) {
  setTimeout(async () => {
    if (gameStore[from]) {
      const revealText = revealFn(gameStore[from]);
      delete gameStore[from];
      try {
        await sock.sendMessage(from, { text: `⏰ ✦ *خلص الوقت (60 ثانية)!* ✦\n\n${revealText}` });
      } catch (e) {
        // تجاهل لو صار خطأ بالإرسال
      }
      await continueEventIfActive(sock, from);
    }
  }, seconds * 1000);
}

async function startRandomGame(sock, from) {
  const type = Math.floor(Math.random() * 11);
  switch (type) {
    case 0: {
      const target = Math.floor(Math.random() * 200) + 1;
      numberGames[from] = { target, attempts: 0, maxAttempts: 8 };
      await sock.sendMessage(from, {
        text: '🎯 ✦ *لعبة تخمين الرقم* ✦\n\nخمّنت رقم بين 1 و200! اكتب رقمك مباشرة.\n🎯 عندك 8 محاولات بس!\n⏰ عندك 60 ثانية.',
      });
      scheduleAnswerTimeout(sock, from, numberGames, (g) => `الرقم كان: ${g.target}`);
      break;
    }
    case 1: {
      const item = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
      quizGames[from] = { answer: item.a.toLowerCase().trim() };
      await sock.sendMessage(from, { text: `🧠 ✦ *سؤال ثقافي* ✦\n\n${item.q}\n\n⏰ عندك 60 ثانية.` });
      scheduleAnswerTimeout(sock, from, quizGames, (g) => `الإجابة كانت: ${g.answer}`);
      break;
    }
    case 2: {
      const { num1, num2, op, answer } = generateMathChallenge();
      mathGames[from] = { answer };
      await sock.sendMessage(from, { text: `🧮 ✦ *حساب سريع* ✦\n\nكم ناتج: ${num1} ${op} ${num2} ؟\n\n⏰ عندك 60 ثانية.` });
      scheduleAnswerTimeout(sock, from, mathGames, (g) => `الإجابة كانت: ${g.answer}`);
      break;
    }
    case 3: {
      const word = scrambleWords[Math.floor(Math.random() * scrambleWords.length)];
      const scrambled = shuffleWord(word);
      scrambleGames[from] = { word };
      await sock.sendMessage(from, { text: `🔤 ✦ *فك الكلمة* ✦\n\nرتّب الحروف: *${scrambled}*\n\n⏰ عندك 60 ثانية.` });
      scheduleAnswerTimeout(sock, from, scrambleGames, (g) => `الكلمة كانت: ${g.word}`);
      break;
    }
    case 4: {
      const r = riddles[Math.floor(Math.random() * riddles.length)];
      riddleGames[from] = { answer: r.a.trim() };
      await sock.sendMessage(from, { text: `🧩 ✦ *لغز* ✦\n\n${r.q}\n\n⏰ عندك 60 ثانية.` });
      scheduleAnswerTimeout(sock, from, riddleGames, (g) => `الإجابة كانت: ${g.answer}`);
      break;
    }
    case 5: {
      const item = trueFalseStatements[Math.floor(Math.random() * trueFalseStatements.length)];
      trueFalseGames[from] = { answer: item.a };
      await sock.sendMessage(from, { text: `✅❌ ✦ *صح أو خطأ* ✦\n\n"${item.s}"\n\n⏰ عندك 60 ثانية.` });
      scheduleAnswerTimeout(sock, from, trueFalseGames, (g) => `الإجابة كانت: ${g.answer}`);
      break;
    }
    case 6: {
      const item = flagCountries[Math.floor(Math.random() * flagCountries.length)];
      flagGames[from] = { name: item.name };
      await sock.sendMessage(from, { text: `🚩 ✦ *خمن الدولة* ✦\n\n${item.flag}\n\n⏰ عندك 60 ثانية.` });
      scheduleAnswerTimeout(sock, from, flagGames, (g) => `الدولة كانت: ${g.name}`);
      break;
    }
    case 7: {
      const item = proverbs[Math.floor(Math.random() * proverbs.length)];
      proverbGames[from] = { answer: item.answer.trim() };
      await sock.sendMessage(from, { text: `📜 ✦ *إكمال المثل* ✦\n\n"${item.half} ..."\n\n⏰ عندك 60 ثانية.` });
      scheduleAnswerTimeout(sock, from, proverbGames, (g) => `تكملة المثل كانت: ${g.answer}`);
      break;
    }
    case 8: {
      const item = famousFigures[Math.floor(Math.random() * famousFigures.length)];
      figureGames[from] = { answer: item.a.trim() };
      await sock.sendMessage(from, { text: `🧠 ✦ *خمن الشخصية* ✦\n\n${item.clue}\n\n⏰ عندك 60 ثانية.` });
      scheduleAnswerTimeout(sock, from, figureGames, (g) => `الشخصية كانت: ${g.answer}`);
      break;
    }
    case 9: {
      const item = fillBlanks[Math.floor(Math.random() * fillBlanks.length)];
      blankGames[from] = { answer: item.a.trim() };
      await sock.sendMessage(from, { text: `✏️ ✦ *الكلمة الناقصة* ✦\n\n${item.sentence}\n\n⏰ عندك 60 ثانية.` });
      scheduleAnswerTimeout(sock, from, blankGames, (g) => `الكلمة كانت: ${g.answer}`);
      break;
    }
    default: {
      const category = categories[Math.floor(Math.random() * categories.length)];
      const letter = arabicLetters[Math.floor(Math.random() * arabicLetters.length)];
      categoryGames[from] = { category, letter };
      await sock.sendMessage(from, {
        text: `🔠 ✦ *تحدي التصنيف* ✦\n\nاكتب اسم *${category}* يبدأ بحرف *${letter}*\n\n⏰ عندك 60 ثانية.`,
      });
      scheduleAnswerTimeout(sock, from, categoryGames, (g) => `الفئة كانت "${g.category}" بحرف "${g.letter}"`);
    }
  }
}

// ننده هاد الدالة بعد كل فوز أو استسلام، وبتبدأ لعبة جديدة تلقائياً إذا الفعالية شغالة
async function continueEventIfActive(sock, from) {
  if (!activeEvents[from]) return;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (!activeEvents[from]) return; // ممكن حدا يكون أوقف الفعالية بهاي الأثناء
  await sock.sendMessage(from, { text: '🎉 ✦ *جولة جديدة!* ✦' });
  await startRandomGame(sock, from);
}

const jokes = [
  'ليش الكمبيوتر روح للدكتور؟ لأنه كان عنده فيروس!',
  'واحد سأل صاحبه: ليش تحب البحر؟ قاله: لأنه ما بيسألني أسئلة كتير!',
  'المعلم سأل الطالب: ليش متأخر؟ قاله: بسبب لافتة كانت مكتوب فيها "المدرسة، رجاءً أبطئ"',
  'ليش السمكة ما بتحب الكمبيوتر؟ لأنها خايفة من الشبكة!',
  'واحد قال لصاحبه: بدي أحفظ رقمك. قاله: لا داعي، أنا أصلاً محفوظ بقلبك 😄',
];

const nicknames = ['الأسطورة', 'الملك', 'النجم الساطع', 'العبقري', 'الفارس', 'البطل الخارق', 'النسر', 'الصقر'];

const funFacts = [
  'الأخطبوط عنده 3 قلوب و9 أدمغة!',
  'العسل ما بيخرب مهما طال الوقت، لقيوا عسل عمره آلاف السنين لسا صالح للأكل.',
  'الموز يعتبر علمياً "توتة" بينما الفراولة لأ!',
  'قلب الروبيان موجود براسها.',
  'لغة الإشارة مو نفسها بكل الدول، فيه لغات إشارة مختلفة زي اللغات المحكية.',
  'النمل ما بينام أبداً طول حياته.',
  'أكبر عدد أضلاع بجسم الإنسان عند الأطفال (300 عظمة) وبتقل لـ206 عند الكبار.',
  'شمس النهار بتاخد حوالي 8 دقايق ونص عشان يوصل ضوها للأرض.',
];

const dailyDares = [
  'ابعت رسالة صوتية بصوت رسمي جداً لأقرب صديق إلك دلوقتي 😂',
  'غيّر صورة البروفايل بشي مضحك لمدة ساعة.',
  'اكتب بالقروب "أنا بطل اليوم" بدون أي سبب 😎',
  'اطلب من حدا بالقروب يمدحك 3 مرات متتالية.',
  'اكتب أغرب حقيقة عنك بالقروب.',
  'قلد شخصية كرتونية برسالة صوتية.',
];

// ==== 🌟 بنك محتوى جديد: 90 أمر يعطوا رد عشوائي من نص فئتهم (اقتباسات / معلومات / عبارات / فأل وشخصية / أسئلة) ====
const newContentBank = {
  ".اقتباس_حب": ["الحب الحقيقي مش إنك تلقى شخص مثالي، إنك تشوف شخص غير مثالي بعيون مثالية.", "أجمل الحب هو اللي بيخليك أحسن نسخة من حالك.", "الحب مو كلام حلو، الحب موقف بيثبت الكلام.", "بيحبك الشخص الصح؟ رح تحس بالراحة مش بالتعب.", "أصعب حب هو اللي بتحب فيه شخص وين ما كان، حتى لو بعيد."],
  ".اقتباس_نجاح": ["النجاح مش إنك ما تقع، النجاح إنك تقوم كل مرة بتقع فيها.", "الطريق للنجاح دايماً تحت الإنشاءات.", "لا تقارن بدايتك بنهاية حدا تاني.", "الفشل مو عكس النجاح، هو جزء منه.", "استمر حتى لو الطريق طويل، الوقوف بالمنتصف مو خيار."],
  ".اقتباس_صداقة": ["الصديق الحقيقي بيعرف كل قصتك، وبرضو بيحبك.", "الأصدقاء زي النجوم، مو دايماً شايفهم بس عارف إنهم موجودين.", "صداقة العمر ما بتتقاس بالسنين، بتتقاس باللحظات.", "أحلى شي بالصداقة إنك تضحك على شي محدا فاهمه غيركم.", "الصديق الصح بيقولك الحقيقة حتى لو صعبة."],
  ".اقتباس_حزين": ["أحياناً الصمت بيحكي أكتر من أي كلمة.", "مو كل جرح بيبين، وبعضهم بيوجع أكتر من اللي بيبين.", "التعب النفسي أصعب من أي تعب جسدي.", "أوقات بتحس إنك تعبان من غير سبب واضح، وهاد طبيعي.", "الابتسامة أحياناً بتخبي وراها قصة تعب طويلة."],
  ".اقتباس_قوة": ["القوة مو إنك ما تقع، القوة إنك تقوم كل مرة.", "أنت أقوى مما تتخيل وأشجع مما تعتقد.", "العواصف بتصنع بحارة أقوى.", "القوة الحقيقية جوانية، مش بالمظهر.", "كل تحدي بتعبره بيخليك أقوى للي بعده."],
  ".اقتباس_تفاؤل": ["بعد كل ليل في صبح، خليك متفائل.", "الحياة بتفاجئك بالحلو لما بتخسر الأمل باللحظة الغلط.", "غيّم اليوم مو معناه رح يضل غيّم للأبد.", "التفاؤل هو الإيمان اللي بيوصلك للإنجاز.", "كل يوم جديد فرصة جديدة، خليك مبتسم."],
  ".حكمة_يومية": ["خذ قرارك وانت هادئ، ونفذه وانت واثق.", "الوقت أثمن من المال، لأنك ما فيك تشتريه.", "اللي بيخاف يجرب، ما بيتعلم أبداً.", "الصبر مفتاح الفرج.", "من جد وجد، ومن زرع حصد."],
  ".حكمة_صينية": ["أطول رحلة بتبلش بخطوة وحدة.", "اللي ما بيتحرك، ما حدا بيلاحظه.", "الرجل الحكيم بيتعلم أكتر من عدوه من صديقه.", "أعطي رجل سمكة تطعمه يوم، علّمه يصطاد تطعمه العمر كله.", "الصبر مرّ بس ثماره حلوة."],
  ".حكمة_عربية": ["رحم الله امرأً عرف قدر نفسه.", "خير الكلام ما قل ودل.", "من طلب العلا سهر الليالي.", "اصبر تنل، فالصبر مفتاح الفرج.", "لسانك حصانك، إن صنته صانك وإن أهنته أهانك."],
  ".فلسفة": ["أنا أفكر، إذاً أنا موجود — ديكارت.", "الحياة اللي ما بتُفحص مو جديرة تُعاش — سقراط.", "الإنسان محكوم عليه إنه يكون حراً — سارتر.", "اللي بيعرف إنه ما بيعرف، أعلم من اللي بيظن إنه بيعرف.", "الحقيقة نادراً ما تكون بسيطة."],
  ".تحفيز_دراسة": ["التعب المؤقت أهون من الندم الدائم، كمّل ذاكر.", "كل صفحة بتقرأها بتقربك خطوة من هدفك.", "النجاح بيبلش من أول محاولة ما تستسلم فيها.", "ادرس اليوم عشان تعيش الحياة يلي بدك ياها بكرا.", "التركيز ساعة أفضل من التشتت يوم كامل."],
  ".تحفيز_رياضة": ["الجسم بيقدر يعمل اللي العقل بيصدقه.", "كل تمرين صعب اليوم بيصير أسهل بكرا.", "الألم مؤقت، التوقف عن المحاولة دائم.", "لا تقارن نفسك بغيرك، قارن نفسك بنفسك امبارح.", "الانضباط هو الجسر بين الهدف والإنجاز."],
  ".تحفيز_عمل": ["الفرص ما بتجي، أنت اللي بتصنعها.", "العمل الجاد بيهزم الموهبة لما الموهبة ما بتشتغل.", "كل خبير كان يوماً مبتدئ.", "النجاح المهني بيبلش بخطوة أول، اليوم هو اليوم.", "لا تخاف تبلش من الصفر، خاف تضل بنفس المكان."],
  ".نصيحة_حب": ["حب نفسك أول، بعدين حب أي حدا تاني.", "العلاقة الصحية بتكبرك مو بتصغرك.", "لا تنتظر حدا يكملك، كون كامل لحالك أول.", "الصدق أساس أي علاقة ناجحة.", "مو كل شخص بيحبك رح يعرف كيف يحافظ عليك."],
  ".نصيحة_دراسة": ["قسّم وقتك: 25 دقيقة تركيز، 5 دقائق راحة.", "راجع يومياً بدل ما تجمّع كل شي لآخر لحظة.", "افهم بدل ما تحفظ، الفهم بيبقى أطول.", "نام كويس، الدماغ بيرتب المعلومات وقت النوم.", "اكتب ملخص بإيدك، بيثبت المعلومة أكتر."],
  ".نصيحة_مال": ["وفّر جزء من كل مصروف، حتى لو صغير.", "لا تشتري شي بس لأنه بالعرض، اشتري اللي محتاجه فعلاً.", "استثمر بنفسك (تعلم مهارة) قبل ما تستثمر بأي شي تاني.", "افصل بين مصاريفك الأساسية والكماليات.", "خطط لمصاريفك قبل ما الشهر يبلش مو وقت ما يخلص."],
  ".رسالة_دعم": ["أنت أقوى مما تتخيل، كمّل.", "مش لازم تكون بخير كل يوم، وهاد طبيعي.", "خذلك وقتك، مافي شي لازم يصير بسرعة.", "اللي عم تمر فيه صعب، بس أنت أصعب منه.", "حتى أصغر تقدم هو تقدم، افتخر فيه."],
  ".رسالة_تحفيزية": ["اليوم يوم جديد، فرصة جديدة تبدأ فيها من جديد.", "لا تستهين بنفسك، أنت قادر أكتر مما تتخيل.", "الخطوة الأولى دايماً أصعب خطوة، بس لازم تصير.", "ثق بالعملية حتى لو ما بتشوف نتيجة فورية.", "كل يوم بتحاول فيه، أنت بتنتصر."],
  ".عبارة_امل": ["بعد كل صعب في سهل جاي.", "الأمل هو الضوء اللي ما بينطفي حتى بأحلك الليالي.", "غداً دايماً بيحمل احتمالات جديدة.", "ما في شي مستحيل، بس في أشياء بتاخد وقت أطول.", "طالما في نفس بتتنفس، في أمل بيستاهل تحاول لأجله."],
  ".جملة_قوة": ["أنا قوي بما فيه الكفاية لأي تحدي جاي.", "التحديات بتصقلني، ما بتكسرني.", "أنا أكبر من أي مشكلة بتواجهني.", "كل يوم بيمر عليّ بيخليني أقوى.", "ما رح أستسلم، مهما طال الطريق."],
  ".مثل_شعبي": ["اللي فات مات.", "يد وحدة ما بتصفق.", "الطيور على أشكالها تقع.", "اللي بيته من زجاج ما يرشق الناس بالحجار.", "القرد بعين أمه غزال."],
  ".مثل_انجليزي": ["Actions speak louder than words — الأفعال أبلغ من الأقوال.", "Better late than never — تأخر ولا يفوت.", "Practice makes perfect — التكرار بيعلّم الشطار.", "Don't judge a book by its cover — لا تحكم على الكتاب من غلافه.", "Where there's a will there's a way — إذا كان في إرادة، في طريقة."],
  ".اقتباس_رياضي": ["البطل مو اللي ما بيقع، البطل اللي بيقوم كل مرة.", "الانتصار الحقيقي هو انتصارك على نفسك امبارح.", "التدريب الصعب بيصنع المباراة السهلة.", "الفريق القوي أقوى من أي لاعب لحاله.", "ما في اختصار للنجاح، بس في تمرين يومي."],
  ".تشجيع_فريق": ["يلا فريقنا، إنتوا الأقوى! 💪", "كل واحد فيكم بطل، سوا أبطال أكتر! 🔥", "ما رح نستسلم، لسا الوقت طويل! ⚡", "التشجيع بيوصلكم، كمّلوا هيك! 🙌", "فخورين فيكم مهما كانت النتيجة! 🏆"],
  ".عبارة_شكر": ["شكراً إلك من كل قلبي على وجودك.", "الامتنان بيخلي القليل يصير كثير.", "شكراً على كل لحظة وقفت فيها جنبي.", "بعض الناس بتستاهل شكر أكبر من الكلام.", "شكراً لأنك دايماً موجود وقت الحاجة."],
  ".معلومة_غريبة": ["قلب الروبيان موجود براسها مو بصدرها.", "العسل ما بيفسد أبداً، لقوا عسل بمقابر فرعونية لسا صالح للأكل.", "الأخطبوط عنده 3 قلوب ودمه أزرق.", "الموز فاكهة، بس الفراولة علمياً مو فاكهة حقيقية.", "بعض النجوم اللي شايفها بالسما ممكن تكون مطفية من زمان."],
  ".معلومة_علمية": ["الضوء بيوصل من الشمس للأرض بحوالي 8 دقايق.", "جسم الإنسان فيه حوالي 37 تريليون خلية.", "الماس ممكن يتكوّن من الكربون تحت ضغط وحرارة عاليين.", "الصوت بيمشي أسرع بالماء منه بالهوا.", "الدماغ البشري بيستهلك حوالي 20% من طاقة الجسم."],
  ".معلومة_تاريخية": ["الأهرامات المصرية أقدم من أول كتابة معروفة بالتاريخ بفترة قريبة.", "الحرب الأطول بالتاريخ استمرت أكتر من 100 سنة (حرب المئة عام).", "أول رسالة بالتلغراف أُرسلت سنة 1844.", "مكتبة الإسكندرية القديمة كانت أكبر مكتبة بالعالم القديم.", "الصين بنت سور عظيم يمتد آلاف الكيلومترات."],
  ".معلومة_حيوانات": ["الزرافة بتنام بس ساعتين باليوم تقريباً.", "النمل بيقدر يحمل أوزان أكبر من وزنه بمرات كتير.", "الفيل الحيوان البري الوحيد اللي ما بيقدر يقفز.", "القطط بتنام حوالي 12-16 ساعة باليوم.", "الدلافين إلها أسماء خاصة (أصوات) بتنادي بعضها فيها."],
  ".معلومة_فضاء": ["يوم على كوكب الزهرة أطول من سنته الكاملة.", "الفضاء صامت تماماً لأنه ما في هوا ينقل الصوت.", "الشمس بتشكل أكتر من 99% من كتلة المجموعة الشمسية.", "على المريخ في أعلى جبل بالمجموعة الشمسية (أوليمبوس مونس).", "لو قدرت تسوق سيارة للشمس بسرعة عادية، رح تاخد أكتر من 100 سنة."],
  ".معلومة_رياضة": ["كرة القدم أكتر رياضة متابعة بالعالم.", "الماراثون سُمي نسبة لمعركة ماراثون باليونان القديمة.", "أولمبياد اليونان القديمة كانت كل 4 سنين، زي اليوم بالضبط.", "أسرع عداء بالعالم بيقطع 100 متر بأقل من 10 ثواني.", "كرة السلة اخترعها معلم كندي سنة 1891."],
  ".معلومة_طعام": ["الشوكولاتة الداكنة فيها مضادات أكسدة أكتر من كتير فواكه.", "الطماطم أصلها من أمريكا الجنوبية مو من إيطاليا.", "العسل هو الطعام الوحيد اللي ما بيفسد نهائياً.", "الفلفل الحار بياخد حرارته من مادة الكابسيسين.", "البطاطا أول خضار انزرعت بالفضاء."],
  ".فوائد_فواكه": ["التفاح بيساعد على صحة القلب وفيه ألياف كتير.", "الموز مصدر ممتاز للبوتاسيوم وبيعطي طاقة سريعة.", "البرتقال غني بفيتامين سي يلي بيقوي المناعة.", "التوت غني بمضادات الأكسدة المفيدة للجسم.", "الرمان معروف بفوائده لصحة القلب والدورة الدموية."],
  ".فوائد_خضار": ["الجزر مفيد للنظر بسبب فيتامين A.", "السبانخ غنية بالحديد وبتعطي طاقة.", "البروكلي فيه فيتامينات ومعادن مهمة كتير.", "الخيار بيرطب الجسم لأنه أغلبه مي.", "الثوم معروف بفوائده لتقوية المناعة."],
  ".فوائد_ماء": ["شرب الماء بيساعد على تركيز أفضل خلال اليوم.", "الماء أساسي لعمل كل خلية بجسمك.", "شرب مي كفاية بيحسّن مظهر البشرة.", "الجفاف الخفيف ممكن يسبب تعب وصداع.", "الماء بيساعد الجسم ينظم درجة حرارته."],
  ".هل_تعلم_علمي": ["هل تعلم إنه الضوء أسرع شي بالكون؟", "هل تعلم إنه جسمك بيصنع خلايا دم جديدة كل يوم؟", "هل تعلم إنه الماء بيغطي حوالي 71% من سطح الأرض؟", "هل تعلم إنه أشعة الشمس بتاخد 8 دقايق توصل للأرض؟", "هل تعلم إنه الدماغ ما فيه ألم لأنه ما فيه مستقبلات ألم؟"],
  ".هل_تعلم_تاريخي": ["هل تعلم إنه أقدم حضارة معروفة هي حضارة سومر؟", "هل تعلم إنه الكتابة اخترعت أول مرة قبل حوالي 5000 سنة؟", "هل تعلم إنه أول أولمبياد كان سنة 776 قبل الميلاد؟", "هل تعلم إنه طريق الحرير كان يربط آسيا بأوروبا؟", "هل تعلم إنه بغداد كانت من أكبر مدن العالم بالعصور الوسطى؟"],
  ".حقيقة_غريبة": ["بعض الفراشات بتقدر تتذوق بأرجلها.", "الأخطبوط بيقدر يغيّر لون جسمه بأجزاء من الثانية.", "شجرة البتولا ممكن تعيش آلاف السنين.", "بعض النجوم أكبر من الشمس بملايين المرات.", "الحلزون بيقدر ينام لمدة سنين متواصلة!"],
  ".اختراع_اليوم": ["الإنترنت غيّر طريقة تواصل البشر للأبد.", "الطباعة سهّلت انتشار المعرفة بشكل كبير.", "الكهرباء غيّرت شكل الحياة اليومية بالكامل.", "الهاتف الذكي صار جزء أساسي من حياتنا اليومية.", "اختراع العجلة من أهم الاختراعات بتاريخ البشرية."],
  ".اكتشاف_علمي": ["اكتشاف الجاذبية غيّر فهمنا للكون.", "اكتشاف الخلية فتح باب علم الأحياء الحديث.", "اكتشاف الكهرباء غيّر مسار التكنولوجيا بالكامل.", "اكتشاف البنسلين أنقذ ملايين الأرواح.", "اكتشاف الحمض النووي DNA غيّر علم الوراثة للأبد."],
  ".عبارة_حب": ["حبك أجمل شي صار معي بحياتي.", "كل ما بشوفك بحس إنه العالم صار أحلى.", "معك بتعلمت معنى الأمان الحقيقي.", "قلبي بيعرف طريقك حتى لو عيوني مسكرة.", "أنت السبب اللي بخليني أبتسم بلا سبب."],
  ".عبارة_صداقة": ["صداقتك كنز ما بينلقى بسهولة.", "معك بضحك من قلبي مو بس من شفايفي.", "أصدقاء العمر هني الكنز الحقيقي.", "شكراً إنك دايماً موجود وقت ما بحتاجك.", "صداقتنا حكاية ما بتخلص."],
  ".عبارة_شوق": ["اشتقتلك أكتر مما بتتخيل.", "كل يوم بدونك حاسس فيه طويل.", "الشوق أحلى إحساس وأصعبه بنفس الوقت.", "بعدك عني خلّاني أقدّر وجودك أكتر.", "قربك أحلى من أي شي، وبعدك أصعب من أي شي."],
  ".عبارة_اعتذار": ["آسف إذا جرحتك، ما كان قصدي أبداً.", "بعتذر منك من قلبي، وبتمنى تسامحني.", "غلطت، وبعترف فيها، سامحني.", "ما بدي كلامي يوجعك، آسف كتير.", "بعتذر، وبوعدك ما رح تتكرر."],
  ".عبارة_فراق": ["الفراق صعب، بس أحياناً بيكون أفضل قرار.", "مو كل وداع نهاية، بعضهم بداية جديدة.", "بعض الناس بتضل بقلبك حتى لو ما ضلوا بحياتك.", "الفراق بيعلّمنا نقدّر اللي كان عنا.", "أصعب وداع هو اللي ما كنت متوقعه."],
  ".رسالة_للصديق": ["بس بدي قلك إني ممتن كتير إنك بحياتي.", "أنت من الأشخاص القليلين اللي بثق فيهم بعمى.", "شكراً لأنك دايماً بتسمعني وقت ما بحتاج حدا.", "صداقتك من أحلى الأشياء اللي صارت معي.", "حابب تعرف إنك مهم إلي كتير."],
  ".عبارة_ام": ["أمي هي أول حب بحياتي وأصدق شخص عرفته.", "دعوة الأم من القلب ما بترد.", "حضن الأم أول مكان أمان بحياة أي إنسان.", "الأم كنز ما بيتقدّر بثمن.", "كل شي تعلمته بالحياة، أساسه من أمي."],
  ".عبارة_اب": ["الأب هو أول بطل بحياة أي طفل.", "قوة الأب بتظهر بصمته أكتر من كلامه.", "تعب الأب من أجل عيلته ما بينوصف.", "الأب سند ما بينكسر.", "كل نجاح بحياتي وراه تعب أبي."],
  ".صباح_الخير": ["صباح الخير، يومكم يكون مليان طاقة إيجابية 🌞", "صباح النور، ابدأ يومك بابتسامة 😊", "صباح الفل، ربنا يوفقك بيومك 🌸", "صباح الخير، خليكم متفائلين اليوم ☀️", "صباح جديد، فرصة جديدة، يلا نبدأ 💪"],
  ".مساء_الخير": ["مساء الخير، خليكم مرتاحين 🌆", "مساء النور، يومكم كان جميل إن شاء الله 🌇", "مساء الورد، وقت الراحة وصل 🌸", "مساء الخير، استرجعوا طاقتكم لبكرا 🌙", "مساء جميل لناس جميلة 💫"],
  ".تصبحون_على_خير": ["تصبحوا على خير، نوم هنيء 🌙", "أحلى الأحلام إلكم، تصبحوا على ألف خير ✨", "ليلة سعيدة وراحة تامة 😴", "تصبحوا على خير، بكرا يوم جديد بإذن الله 🌟", "نوم هادئ وأحلام حلوة 💤"],
  ".مجاملة_ذكاء": ["طريقة تفكيرك رائعة، أنت شخص ذكي فعلاً.", "دايماً بتلاقي حلول ما حدا فكر فيها.", "ذكاؤك واضح من طريقة كلامك.", "أسلوبك بحل المشاكل يخلي أي شي يبدو سهل.", "عندك عقل تحليلي مميز فعلاً."],
  ".مجاملة_ابداع": ["إبداعك واضح بكل شي بتسويه.", "عندك لمسة فنية خاصة فيك.", "أفكارك دايماً خارج الصندوق.", "طريقتك بالتعبير مميزة كتير.", "موهبتك الإبداعية شي يستاهل الفخر."],
  ".اطراء": ["أنت شخص مميز فعلاً، وطريقتك بالتعامل رائعة.", "طاقتك الإيجابية بتأثر بكل اللي حواليك.", "شخصيتك جذابة كتير.", "دايماً بتترك انطباع حلو بأي مكان بتكون فيه.", "أنت أحسن مما تتخيل عن نفسك."],
  ".رد_ذكي": ["الرد الذكي أحياناً هو السكوت.", "الكلمة الصح بالوقت الصح أقوى من ألف كلمة.", "أحياناً أذكى رد هو الابتسامة وبس.", "ما كل سؤال يستاهل جواب.", "الرد الهادئ بيوقف أي نقاش حاد."],
  ".رد_ساخر": ["واو، فكرة عبقرية... تقريباً.", "أكيد، وأنا وزير الاقتصاد 😏", "معلومة مذهلة، شكراً لتنويري 🙄", "طبعاً، لأنه كل شي ممكن يصير بالتفكير الإيجابي 😂", "ما شاء الله، خبير بكل شي!"],
  ".تندر": ["ليش عم تشرح، فهمت من الوجه!", "خلص خلص، ما إلها داعي كل هالحكي.", "يا زلمة روق شوي، الدنيا سهلة.", "ولا يهمك، بكرا بتنسى الموضوع.", "شكلك عم تاخد الموضوع بجدية زيادة 😄"],
  ".افيه": ["قال اللي ما بيعرف يحكي، بيقول ما بعرف!", "الدنيا فرصة وحدة، خليك ذكي.", "امشي دغري بيهابوك الأعوج.", "اللي بيده بالمي مش متل اللي بيده بالنار.", "بلاش تحكي كتير وسوي شوي."],
  ".موقف_محرج": ["لما تسلّم على حدا فاكرو صاحبك وطلع غريب.", "لما تضحك لوحدك وتذكر إنه محدا حكالك نكتة.", "لما ترد عالمكالمة وتقول 'حاضر' لحدا غير اللي متوقع.", "لما تفتكر إنه حدا نادالك وتلتفت ومحدا فيه.", "لما تحكي عن حدا وتلاقيه واقف وراك."],
  ".قصة_قصيرة": ["كان في رجل بيحلم دايماً... لحد ما قرر يحوّل حلمه لخطة، وصار حقيقة.", "بنت صغيرة سألت أباها: ليش النجوم بعيدة؟ قالها: عشان تضل جميلة وأنت تحلم فيها.", "شاب فشل مية مرة، بالمرة المية وواحد نجح، وقال: كل فشلة كانت درس.", "عجوز زرعت شجرة بتعرف ما رح تشوف ظلها، بس زرعتها لغيرها.", "طفل سأل: ليش السما زرقاء؟ أمه قالت: عشان تفكر وتسأل زي هلق."],
  ".برجك": ["برجك اليوم بيقول: يوم مليان طاقة، استغله منيح!", "النجوم بتهمس إنه اليوم فرصة حلوة قدامك.", "برجك بيشير لتغيير إيجابي قريب.", "اليوم يوم مناسب لقرارات مهمة.", "طاقتك اليوم عالية، استخدمها بأفضل شكل."],
  ".فالك": ["فالك اليوم: خبر حلو جاي قريب!", "فالك يقول: صبرك قريب يثمر.", "فالك: يوم فيه مفاجأة سارة.", "فالك: علاقاتك رح تتحسن هالفترة.", "فالك: فرصة ذهبية ببابك، افتحه!"],
  ".توقع_يومك": ["يومك اليوم رح يكون مليان إنجاز!", "توقع مفاجأة حلوة قبل ما ينتهي اليوم.", "يومك هادي ومريح، استمتع فيه.", "توقع لقاء مهم أو خبر جيد اليوم.", "يوم مناسب للتخطيط لمستقبلك."],
  ".تفسير_حلم": ["حلمك بيرمز لتغيير جاي بحياتك قريباً.", "الحلم ده معناه راحة بال جايالك.", "حلمك بيدل على إنجاز رح تحققه قريباً.", "هاد الحلم بيرمز لفرصة جديدة قدامك.", "حلمك بيعكس تفكيرك بموضوع مهم هالفترة."],
  ".تحليل_شخصية": ["شخصيتك قيادية، بتحب تاخد زمام الأمور.", "أنت شخص حساس وعاطفي أكتر مما تظهر.", "شخصيتك مغامرة، بتحب التجارب الجديدة.", "أنت شخص هادئ بس عميق التفكير.", "شخصيتك اجتماعية، بتحب تكون محاط بالناس."],
  ".صفة_اليوم": ["صفتك اليوم: الصبر.", "صفتك اليوم: الحماس.", "صفتك اليوم: الحكمة.", "صفتك اليوم: الكرم.", "صفتك اليوم: القوة الهادئة."],
  ".لون_يومك": ["لون يومك: أزرق — هدوء وثقة.", "لون يومك: أحمر — طاقة وحماس.", "لون يومك: أخضر — توازن ونمو.", "لون يومك: أصفر — تفاؤل وإشراق.", "لون يومك: بنفسجي — إبداع وإلهام."],
  ".حيوانك_الروحي": ["حيوانك الروحي: الأسد — قوي وقيادي.", "حيوانك الروحي: البومة — حكيم ومراقب.", "حيوانك الروحي: الذئب — وفي ومستقل.", "حيوانك الروحي: الفراشة — متجدد ومتحول.", "حيوانك الروحي: النسر — طموح وحر."],
  ".طبقك_المفضل": ["شخصيتك تناسبها المنسف — كرم وأصالة.", "شخصيتك تناسبها الكبسة — دفء وترحيب.", "شخصيتك تناسبها البيتزا — تنوع وحيوية.", "شخصيتك تناسبها الشاورما — بساطة وطعم مميز.", "شخصيتك تناسبها الكنافة — حلاوة وسخاء."],
  ".اغنية_اليوم": ["أغنيتك اليوم لازم تكون مبهجة، تستاهل يوم حلو!", "اليوم يوم الأغاني الهادية، ريّح بالك.", "خلي أغنيتك اليوم فيها طاقة، عندك يوم طويل!", "أغنية حماسية بتناسب طاقتك اليوم.", "أغنية رومانسية تناسب مزاجك اليوم."],
  ".فيلم_اليوم": ["اليوم يوم مناسب لفيلم كوميدي يضحكك.", "جرب فيلم مغامرات اليوم، طاقتك عالية.", "فيلم رومانسي يناسب مزاجك اليوم.", "اليوم مناسب لفيلم تشويقي يخليك متحمس.", "فيلم هادي ومريح يناسب يومك."],
  ".كتاب_اليوم": ["اليوم يوم مناسب لكتاب تطوير ذات.", "جرب رواية اليوم، عقلك بحاجة خيال.", "كتاب تاريخي رح يناسب فضولك اليوم.", "اليوم مناسب لكتاب فلسفي يخليك تفكر.", "كتاب خفيف ومسلي يناسب مزاجك اليوم."],
  ".قوتك_الخفية": ["قوتك الخفية: القدرة على تهدئة أي حدا حولك.", "قوتك الخفية: الصبر اللي ما حدا يلاحظه.", "قوتك الخفية: حدسك القوي بالحكم على المواقف.", "قوتك الخفية: القدرة على إلهام الناس من حولك.", "قوتك الخفية: قدرتك على حل المشاكل بهدوء."],
  ".صفتك_المميزة": ["صفتك المميزة: الإخلاص لمن تحب.", "صفتك المميزة: الصدق مهما كلفك.", "صفتك المميزة: القدرة على التكيف بسرعة.", "صفتك المميزة: الكرم بلا مقابل.", "صفتك المميزة: العزيمة اللي ما بتنكسر."],
  ".حقيقة_عني": ["حقيقة عنك: أنت أقوى مما تتخيل.", "حقيقة عنك: الناس بتثق فيك أكتر مما تعتقد.", "حقيقة عنك: عندك تأثير إيجابي على اللي حولك.", "حقيقة عنك: بتستاهل كل شي حلو بيصير معك.", "حقيقة عنك: قدراتك أكبر من اللي بتظن."],
  ".اسمك_يعني": ["اسمك يحمل معنى القوة والثبات.", "اسمك يرمز للطيبة والكرم.", "اسمك يعني النور والتفاؤل.", "اسمك يحمل معنى الحكمة والهدوء.", "اسمك يرمز للشجاعة والإصرار."],
  ".لقبك_الحربي": ["لقبك الحربي: الصقر الهادئ.", "لقبك الحربي: النمر الصامت.", "لقبك الحربي: العاصفة الذكية.", "لقبك الحربي: الأسطورة الخفية.", "لقبك الحربي: الظل السريع."],
  ".شخصيتك_كرتونية": ["شخصيتك الكرتونية: بطل هادئ بيحل المشاكل بذكاء.", "شخصيتك الكرتونية: مغامر ما بيخاف من شي.", "شخصيتك الكرتونية: الصديق المرح اللي بيضحك الكل.", "شخصيتك الكرتونية: العبقري اللي دايماً عنده خطة.", "شخصيتك الكرتونية: القائد اللي بيوحد الفريق."],
  ".مصيرك": ["مصيرك فيه نجاح كبير لو استمريت بنفس الجهد.", "مصيرك مرتبط بقرار مهم رح تاخده قريباً.", "مصيرك فيه مفاجأة حلوة تستاهل الانتظار.", "مصيرك بإيدك أكتر مما تتخيل.", "مصيرك مليان فرص لو فتحت عيونك إلها."],
  ".عمرك_النفسي": ["عمرك النفسي أكبر من عمرك الحقيقي، ناضج بتفكيرك.", "عمرك النفسي صغير وحيوي، بتحب الحياة بعفوية.", "عمرك النفسي متوازن، بتجمع بين الحكمة والمرح.", "عمرك النفسي هادي، بتفكر قبل ما تتصرف.", "عمرك النفسي مغامر، بتحب التجديد دايماً."],
  ".سؤال_فلسفي": ["هل الحرية الكاملة موجودة فعلاً؟", "هل السعادة اختيار ولا ظرف؟", "هل الحقيقة نسبية ولا مطلقة؟", "هل الإنسان خيّر بطبعه ولا الظروف بتشكله؟", "هل الوقت موجود فعلاً ولا هو بس إدراكنا؟"],
  ".سؤال_عميق": ["شو أكتر شي بتندم عليه بحياتك؟", "لو فيك تغيّر قرار واحد، شو بيكون؟", "شو بيخوفك أكتر من أي شي تاني؟", "شو أكتر لحظة أثرت فيك بحياتك؟", "لو بقي إلك سنة وحدة بس، شو رح تسوي؟"],
  ".سؤال_محرج": ["أغرب شي عملته وحدا شافك فيه؟", "أكتر كذبة بيضاء قلتها؟", "أطرف موقف صار معك قدام ناس؟", "شو أكتر شي بتخجل منه من طفولتك؟", "أغرب رسالة بعتتها لشخص غلط؟"],
  ".لو_خيروك": ["لو خيروك بين السفر بدون فلوس أو الفلوس بدون سفر، شو تختار؟", "لو خيروك تعيش بلا إنترنت أو بلا تلفون، شو تختار؟", "لو خيروك تعرف المستقبل أو تنسى الماضي، شو تختار؟", "لو خيروك بين الشهرة أو الراحة النفسية، شو تختار؟", "لو خيروك بين صديق واحد صادق أو مية معرفة، شو تختار؟"],
  ".سؤال_تعارف": ["شو أكتر شي بيضحكك؟", "شو هوايتك المفضلة بوقت فراغك؟", "لو فيك تسافر لأي بلد، وين بتروح؟", "شو أكلتك المفضلة؟", "شو أكتر شي بتحب تسويه بعطلتك؟"],
  ".سؤال_صداقة": ["شو أكتر ذكرى حلوة مع صحابك؟", "مين أكتر شخص وثقت فيه بحياتك؟", "شو أكتر شي بتقدره بصديق؟", "شو أطول صداقة عندك؟", "شو أكتر موقف ضحكتوا فيه سوا؟"],
  ".سؤال_زواج": ["شو أهم صفة لازم تكون بشريك الحياة؟", "شو رأيك بالزواج المبكر ولا المتأخر؟", "شو أهم شي بالعلاقة الناجحة برأيك؟", "كيف بتتخيل حفلة زفافك المثالية؟", "شو أكتر شي بتتمناه من شريك المستقبل؟"],
  ".اعتراف": ["أحياناً بتظاهر إني بخير وأنا مش هيك.", "بخاف من الفشل أكتر مما بحكي.", "بحب أضحك بس جوايا تعبان أحياناً.", "بتمنى كنت أشجع بقرارات معينة.", "بحس أحياناً إني لحالي حتى بنص الزحمة."],
  ".سر": ["سر بسيط: كل إنسان بيخبي جزء من حاله.", "سر: أكتر الناس ابتسامة، أكتر الناس تعب.", "سر: الصمت أحياناً بيحكي أكتر من الكلام.", "سر: كل شخص بيحارب معركة ما حدا شايفها.", "سر: أقوى الناس هني اللي بيخبوا ضعفهم منيح."],
  ".ذكرى": ["أحلى ذكرى هي اللي بترجع لبالك وأنت مبتسم.", "الذكريات الحلوة كنز ما حدا فيه ياخده منك.", "بعض اللحظات بتضل عالقة بقلبك للأبد.", "الذكريات هي الطريقة اللي فيها نعيش الماضي من جديد.", "أجمل الذكريات بتصير من غير ما تخطط إلها."],
};

// ==== 🧰 أدوات جديدة بمنطق حقيقي (رياضيات/نصوص/تحويلات) — كل أمر بيرجع نص جاهز للإرسال، أو null لو في خطأ بالمدخلات ====
const mathUtilCommands = {
  '.جذر_تربيعي': (a) => {
    const n = parseFloat(a[0]);
    if (isNaN(n) || n < 0) return '⚠️ اكتب رقم موجب، مثال: .جذر_تربيعي 25';
    return `√${n} = ${Math.sqrt(n)}`;
  },
  '.قوة': (a) => {
    const base = parseFloat(a[0]), exp = parseFloat(a[1]);
    if (isNaN(base) || isNaN(exp)) return '⚠️ مثال: .قوة 2 10';
    return `${base}^${exp} = ${Math.pow(base, exp)}`;
  },
  '.مضروب': (a) => {
    const n = parseInt(a[0], 10);
    if (isNaN(n) || n < 0 || n > 170) return '⚠️ اكتب رقم صحيح من 0 لـ170، مثال: .مضروب 5';
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return `${n}! = ${r}`;
  },
  '.متوسط': (a) => {
    const nums = a.map(Number).filter((n) => !isNaN(n));
    if (nums.length === 0) return '⚠️ اكتب أرقام مفصولة بمسافة، مثال: .متوسط 5 10 15';
    const avg = nums.reduce((s, n) => s + n, 0) / nums.length;
    return `📊 المتوسط: ${avg.toFixed(2)}`;
  },
  '.اكبر_رقم': (a) => {
    const nums = a.map(Number).filter((n) => !isNaN(n));
    if (nums.length === 0) return '⚠️ اكتب أرقام مفصولة بمسافة';
    return `🔝 الأكبر: ${Math.max(...nums)}`;
  },
  '.اصغر_رقم': (a) => {
    const nums = a.map(Number).filter((n) => !isNaN(n));
    if (nums.length === 0) return '⚠️ اكتب أرقام مفصولة بمسافة';
    return `🔻 الأصغر: ${Math.min(...nums)}`;
  },
  '.نسبة_مئوية': (a) => {
    const part = parseFloat(a[0]), total = parseFloat(a[1]);
    if (isNaN(part) || isNaN(total) || total === 0) return '⚠️ مثال: .نسبة_مئوية 25 200';
    return `📐 ${part} من ${total} = ${((part / total) * 100).toFixed(2)}%`;
  },
  '.سنة_كبيسة': (a) => {
    const y = parseInt(a[0], 10);
    if (isNaN(y)) return '⚠️ مثال: .سنة_كبيسة 2024';
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return leap ? `✅ سنة ${y} كبيسة (366 يوم)` : `❌ سنة ${y} مش كبيسة (365 يوم)`;
  },
  '.تحويل_ثانية': (a) => {
    const s = parseInt(a[0], 10);
    if (isNaN(s) || s < 0) return '⚠️ مثال: .تحويل_ثانية 9000';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `⏱️ ${s} ثانية = ${h} ساعة، ${m} دقيقة، ${sec} ثانية`;
  },
  '.تحويل_ثنائي': (a) => {
    const n = parseInt(a[0], 10);
    if (isNaN(n) || n < 0) return '⚠️ مثال: .تحويل_ثنائي 42';
    return `🔢 ${n} بالثنائي = ${n.toString(2)}`;
  },
  '.تحويل_سداسي': (a) => {
    const n = parseInt(a[0], 10);
    if (isNaN(n) || n < 0) return '⚠️ مثال: .تحويل_سداسي 255';
    return `🔢 ${n} بالسداسي = ${n.toString(16).toUpperCase()}`;
  },
  '.ثنائي_الى_عشري': (a) => {
    const b = a[0];
    if (!b || !/^[01]+$/.test(b)) return '⚠️ اكتب رقم ثنائي صحيح، مثال: .ثنائي_الى_عشري 101010';
    return `🔢 ${b} بالثنائي = ${parseInt(b, 2)} بالعشري`;
  },
  '.base64_تشفير': (a) => {
    const text = a.join(' ');
    if (!text) return '⚠️ اكتب نص، مثال: .base64_تشفير مرحبا';
    return `🔐 ${Buffer.from(text, 'utf-8').toString('base64')}`;
  },
  '.base64_فك': (a) => {
    const text = a.join(' ');
    if (!text) return '⚠️ اكتب النص المشفر، مثال: .base64_فك 2YXYsdit2KjYpw==';
    try {
      return `🔓 ${Buffer.from(text, 'base64').toString('utf-8')}`;
    } catch (e) {
      return '⚠️ النص مش base64 صحيح.';
    }
  },
  '.احرف_كبيرة': (a) => {
    const t = a.join(' ');
    if (!t) return '⚠️ اكتب نص إنجليزي، مثال: .احرف_كبيرة hello';
    return t.toUpperCase();
  },
  '.احرف_صغيرة': (a) => {
    const t = a.join(' ');
    if (!t) return '⚠️ اكتب نص إنجليزي، مثال: .احرف_صغيرة HELLO';
    return t.toLowerCase();
  },
  '.عدد_الاسطر': (a) => {
    const t = a.join(' ');
    if (!t) return '⚠️ اكتب نص';
    return `📄 عدد الكلمات: ${t.trim().split(/\s+/).filter(Boolean).length}`;
  },
  '.حذف_المسافات': (a) => {
    const t = a.join(' ');
    if (!t) return '⚠️ اكتب نص';
    return t.replace(/\s+/g, '');
  },
  '.مولد_باسورد': (a) => {
    let len = parseInt(a[0], 10);
    if (isNaN(len) || len < 4 || len > 32) len = 12;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
    let pass = '';
    for (let i = 0; i < len; i++) pass += chars[Math.floor(Math.random() * chars.length)];
    return `🔑 كلمة السر: ${pass}`;
  },
  '.رقم_عشوائي': (a) => {
    const min = parseInt(a[0], 10), max = parseInt(a[1], 10);
    if (isNaN(min) || isNaN(max) || min > max) return '⚠️ مثال: .رقم_عشوائي 1 100';
    return `🎲 ${Math.floor(Math.random() * (max - min + 1)) + min}`;
  },
  '.قاسم_مشترك': (a) => {
    let x = Math.abs(parseInt(a[0], 10)), y = Math.abs(parseInt(a[1], 10));
    if (isNaN(x) || isNaN(y)) return '⚠️ مثال: .قاسم_مشترك 24 36';
    while (y) { [x, y] = [y, x % y]; }
    return `🔢 القاسم المشترك الأكبر: ${x}`;
  },
  '.مضاعف_مشترك': (a) => {
    const x = Math.abs(parseInt(a[0], 10)), y = Math.abs(parseInt(a[1], 10));
    if (isNaN(x) || isNaN(y) || x === 0 || y === 0) return '⚠️ مثال: .مضاعف_مشترك 4 6';
    let g1 = x, g2 = y;
    while (g2) { [g1, g2] = [g2, g1 % g2]; }
    return `🔢 المضاعف المشترك الأصغر: ${(x * y) / g1}`;
  },
  '.اولي': (a) => {
    const n = parseInt(a[0], 10);
    if (isNaN(n) || n < 2) return '⚠️ اكتب رقم أكبر من 1، مثال: .اولي 17';
    let isPrime = true;
    for (let i = 2; i * i <= n; i++) if (n % i === 0) { isPrime = false; break; }
    return isPrime ? `✅ ${n} رقم أولي` : `❌ ${n} مش رقم أولي`;
  },
  '.فيبوناتشي': (a) => {
    let n = parseInt(a[0], 10);
    if (isNaN(n) || n < 1 || n > 30) n = 10;
    const seq = [0, 1];
    for (let i = 2; i < n; i++) seq.push(seq[i - 1] + seq[i - 2]);
    return `🔢 متتالية فيبوناتشي: ${seq.slice(0, n).join(', ')}`;
  },
  '.جمع_ارقام': (a) => {
    const n = a[0];
    if (!n || !/^\d+$/.test(n)) return '⚠️ مثال: .جمع_ارقام 12345';
    const sum = n.split('').reduce((s, d) => s + parseInt(d, 10), 0);
    return `➕ مجموع أرقام ${n} = ${sum}`;
  },
  '.عكس_رقم': (a) => {
    const n = a[0];
    if (!n || !/^\d+$/.test(n)) return '⚠️ مثال: .عكس_رقم 12345';
    return `🔄 معكوس ${n} = ${n.split('').reverse().join('')}`;
  },
  '.تربيع': (a) => {
    const n = parseFloat(a[0]);
    if (isNaN(n)) return '⚠️ مثال: .تربيع 7';
    return `${n}² = ${n * n}`;
  },
  '.تكعيب': (a) => {
    const n = parseFloat(a[0]);
    if (isNaN(n)) return '⚠️ مثال: .تكعيب 3';
    return `${n}³ = ${n * n * n}`;
  },
  '.مساحة_دائرة': (a) => {
    const r = parseFloat(a[0]);
    if (isNaN(r) || r < 0) return '⚠️ مثال: .مساحة_دائرة 5';
    return `⭕ مساحة الدائرة = ${(Math.PI * r * r).toFixed(2)}`;
  },
  '.محيط_دائرة': (a) => {
    const r = parseFloat(a[0]);
    if (isNaN(r) || r < 0) return '⚠️ مثال: .محيط_دائرة 5';
    return `⭕ محيط الدائرة = ${(2 * Math.PI * r).toFixed(2)}`;
  },
  '.مساحة_مربع': (a) => {
    const s = parseFloat(a[0]);
    if (isNaN(s) || s < 0) return '⚠️ مثال: .مساحة_مربع 4';
    return `◻️ مساحة المربع = ${s * s}`;
  },
  '.مساحة_مستطيل': (a) => {
    const l = parseFloat(a[0]), w = parseFloat(a[1]);
    if (isNaN(l) || isNaN(w)) return '⚠️ مثال: .مساحة_مستطيل 5 3';
    return `▭ مساحة المستطيل = ${l * w}`;
  },
  '.حجم_مكعب': (a) => {
    const s = parseFloat(a[0]);
    if (isNaN(s) || s < 0) return '⚠️ مثال: .حجم_مكعب 3';
    return `🧊 حجم المكعب = ${(s ** 3).toFixed(2)}`;
  },
  '.درجة_الى_راديان': (a) => {
    const d = parseFloat(a[0]);
    if (isNaN(d)) return '⚠️ مثال: .درجة_الى_راديان 180';
    return `📐 ${d}° = ${(d * Math.PI / 180).toFixed(4)} راديان`;
  },
  '.راديان_الى_درجة': (a) => {
    const r = parseFloat(a[0]);
    if (isNaN(r)) return '⚠️ مثال: .راديان_الى_درجة 3.14';
    return `📐 ${r} راديان = ${(r * 180 / Math.PI).toFixed(2)}°`;
  },
  '.جدول_الضرب': (a) => {
    const n = parseInt(a[0], 10);
    if (isNaN(n)) return '⚠️ مثال: .جدول_الضرب 7';
    let lines = [];
    for (let i = 1; i <= 10; i++) lines.push(`${n} × ${i} = ${n * i}`);
    return `✖️ جدول ضرب ${n}:\n${lines.join('\n')}`;
  },
  '.تحويل_وقت_12': (a) => {
    const t = a[0];
    if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return '⚠️ مثال: .تحويل_وقت_12 14:30';
    let [h, m] = t.split(':').map(Number);
    const period = h >= 12 ? 'م' : 'ص';
    h = h % 12 || 12;
    return `🕐 ${h}:${String(m).padStart(2, '0')} ${period}`;
  },
};


// ==== 🎮 ألعاب سريعة جديدة (نتيجة فورية عشوائية) — كل دالة بترجع نص الرد جاهز ====
const quickGameCommands = {
  '.رمي_عملة': () => {
    const r = Math.random() < 0.5 ? 'صورة 🪙' : 'كتابة 🪙';
    return `🪙 رمينا العملة... النتيجة: *${r}*`;
  },
  '.نرد_مزدوج': () => {
    const d1 = Math.floor(Math.random() * 6) + 1, d2 = Math.floor(Math.random() * 6) + 1;
    return `🎲🎲 رميت زوج نرد: ${d1} و ${d2} (المجموع: ${d1 + d2})`;
  },
  '.نرد_ثلاثي': () => {
    const d = [1, 2, 3].map(() => Math.floor(Math.random() * 6) + 1);
    return `🎲🎲🎲 رميت 3 نرد: ${d.join(', ')} (المجموع: ${d.reduce((a, b) => a + b, 0)})`;
  },
  '.ايهما_اكبر': () => {
    const a = Math.floor(Math.random() * 100) + 1, b = Math.floor(Math.random() * 100) + 1;
    const bigger = a === b ? 'متساويين!' : a > b ? `الرقم الأول (${a})` : `الرقم الثاني (${b})`;
    return `🔢 الرقم الأول: ${a} | الرقم الثاني: ${b}\nالأكبر: ${bigger}`;
  },
  '.مين_يربح': () => {
    const options = ['اللاعب الأول 🥇', 'اللاعب الثاني 🥈', 'تعادل! 🤝'];
    return `🏆 نتيجة المباراة الافتراضية: ${options[Math.floor(Math.random() * options.length)]}`;
  },
  '.بطاقة_تاروت': () => {
    const cards = ['🌟 النجمة — أمل وإلهام', '☀️ الشمس — سعادة ونجاح', '🌙 القمر — غموض وحدس', '⚔️ الفارس — شجاعة وحركة', '👑 الملك — قوة وقيادة', '🔮 العرافة — حكمة داخلية', '🎡 عجلة الحظ — تغيير قادم'];
    return `🃏 سحبت بطاقة: ${cards[Math.floor(Math.random() * cards.length)]}`;
  },
  '.كلمة_السر': () => {
    const words = ['قمر', 'بحر', 'نجمة', 'شمس', 'سحاب', 'جبل', 'وادي', 'نسيم'];
    return `🔑 كلمة السر اليوم: *${words[Math.floor(Math.random() * words.length)]}*`;
  },
  '.صح_ام_خطأ_عام': () => {
    const statements = [
      { s: 'الشمس أكبر من الأرض بكتير', a: true },
      { s: 'الفيل أثقل حيوان بري بالعالم', a: true },
      { s: 'الضفدع بيقدر يطير', a: false },
      { s: 'الماء بيغلي عند 100 درجة مئوية على سطح البحر', a: true },
      { s: 'القمر كوكب', a: false },
    ];
    const pick = statements[Math.floor(Math.random() * statements.length)];
    return `❓ "${pick.s}"\n\nالإجابة: ${pick.a ? '✅ صح' : '❌ خطأ'}`;
  },
  '.سؤال_رياضة': () => {
    const qs = [
      'كأس العالم بتصير كل كم سنة؟ → 4 سنين',
      'كم لاعب بفريق كرة القدم بالملعب؟ → 11 لاعب',
      'كم شوط بمباراة كرة السلة عادة؟ → 4 أشواط',
      'أولمبياد الشتاء والصيف بينهم كم سنة؟ → سنتين',
    ];
    return `⚽ ${qs[Math.floor(Math.random() * qs.length)]}`;
  },
  '.سؤال_جغرافيا': () => {
    const qs = [
      'أطول نهر بالعالم؟ → نهر النيل',
      'أكبر قارة بالعالم؟ → آسيا',
      'أصغر دولة بالعالم؟ → الفاتيكان',
      'أعلى جبل بالعالم؟ → إفرست',
      'أكبر محيط؟ → المحيط الهادئ',
    ];
    return `🌍 ${qs[Math.floor(Math.random() * qs.length)]}`;
  },
  '.سؤال_علوم': () => {
    const qs = [
      'كم عدد كواكب المجموعة الشمسية؟ → 8 كواكب',
      'شو الغاز اللي بنتنفسه للحياة؟ → الأكسجين',
      'شو أسرع شي بالكون؟ → الضوء',
      'كم عظمة بجسم الإنسان البالغ؟ → 206 عظمة',
    ];
    return `🔬 ${qs[Math.floor(Math.random() * qs.length)]}`;
  },
  '.سؤال_تاريخ': () => {
    const qs = [
      'بأي سنة انتهت الحرب العالمية الثانية؟ → 1945',
      'مين اخترع المصباح الكهربائي؟ → توماس إديسون',
      'أقدم حضارة معروفة بالتاريخ؟ → حضارة سومر',
    ];
    return `📜 ${qs[Math.floor(Math.random() * qs.length)]}`;
  },
  '.سؤال_لغة': () => {
    const qs = [
      'شو جمع كلمة "قلم"؟ → أقلام',
      'شو مرادف كلمة "سعيد"؟ → فرحان',
      'شو عكس كلمة "كبير"؟ → صغير',
      'شو جمع كلمة "كتاب"؟ → كتب',
    ];
    return `📖 ${qs[Math.floor(Math.random() * qs.length)]}`;
  },
  '.استنتاج': () => {
    const riddles = [
      'شي بيمشي بلا رجلين، بيطير بلا جناحين، وبيبكي بلا عيون؟ → السحاب',
      'شي كل ما اخدت منه كبر؟ → الحفرة',
      'إيش اللي بيروح ويجي بس ما بيتحرك من مكانه؟ → الطريق',
      'شي إلها أسنان بس ما بتاكل؟ → المشط',
    ];
    return `🧩 ${riddles[Math.floor(Math.random() * riddles.length)]}`;
  },
  '.احجية_رياضية': () => {
    const puzzles = [
      'لو 2 دجاجة بيضوا 2 بيضة بيومين، كم بيضة بتبيض 4 دجاجات ب4 أيام؟ → 8 بيضات',
      'شو الرقم اللي لو ضربته بنفسه طلع 81؟ → 9',
      'لو عمرك ضعف عمر أخوك، وأخوك عمره 10، قديش عمرك؟ → 20',
    ];
    return `➗ ${puzzles[Math.floor(Math.random() * puzzles.length)]}`;
  },
  '.فزورة': () => {
    const fs = [
      'إيش الشي يمشي واقف؟ → الساعة',
      'بيت بلا أبواب ولا شبابيك؟ → البيضة',
      'شي بيته من ورق وما بيقدر يطلع منه؟ → الكتاب',
    ];
    return `🎯 ${fs[Math.floor(Math.random() * fs.length)]}`;
  },
  '.تحدي_سريع': () => {
    const t = ['عد لـ20 بأسرع وقت واكتب "خلصت"!', 'اكتب اسمك معكوس بأسرع وقت!', 'سمّي 5 حيوانات خلال 10 ثواني!'];
    return `⚡ تحدي: ${t[Math.floor(Math.random() * t.length)]}`;
  },
  '.مسابقة_ثقافية': () => {
    const qs = [
      'عاصمة اليابان؟ → طوكيو',
      'أكبر دولة بالمساحة؟ → روسيا',
      'لغة أكتر بلد بالعالم بتحكيها؟ → الإنجليزية',
      'عملة اليابان؟ → الين',
    ];
    return `🏅 ${qs[Math.floor(Math.random() * qs.length)]}`;
  },
  '.توقع_النتيجة': () => {
    const outcomes = ['فوز ساحق 🏆', 'تعادل مثير 🤝', 'خسارة بس تجربة حلوة 💪', 'مفاجأة غير متوقعة! 😲'];
    return `🔮 توقع النتيجة: ${outcomes[Math.floor(Math.random() * outcomes.length)]}`;
  },
  '.تحدي_حظ': () => {
    const result = Math.random() < 0.5 ? '🍀 حظك اليوم عالي!' : '😅 حظك اليوم عادي، جرب بكرا';
    return result;
  },
  '.صندوق_الحظ': () => {
    const prizes = ['🎁 ربحت مفاجأة وهمية!', '📦 الصندوق فاضي هالمرة!', '💎 لقيت كنز وهمي!', '🎈 بالون فرح!'];
    return prizes[Math.floor(Math.random() * prizes.length)];
  },
  '.بوابة_الحظ': () => {
    const doors = ['🚪 وراء الباب: مفاجأة حلوة!', '🚪 وراء الباب: ولا شي هالمرة', '🚪 وراء الباب: حظ سعيد ينتظرك!'];
    return doors[Math.floor(Math.random() * doors.length)];
  },
  '.عجلة_الالوان': () => {
    const colors = ['أحمر 🔴', 'أزرق 🔵', 'أخضر 🟢', 'أصفر 🟡', 'بنفسجي 🟣', 'برتقالي 🟠'];
    return `🎡 العجلة وقفت على: ${colors[Math.floor(Math.random() * colors.length)]}`;
  },
  '.تخمين_الحيوان': () => {
    const animals = ['🦁 أسد', '🐘 فيل', '🐺 ذئب', '🦊 ثعلب', '🐯 نمر', '🐻 دب'];
    return `🐾 الحيوان السري كان: ${animals[Math.floor(Math.random() * animals.length)]}`;
  },
  '.تخمين_الفاكهة': () => {
    const fruits = ['🍎 تفاح', '🍌 موز', '🍇 عنب', '🍉 بطيخ', '🍍 أناناس', '🥭 مانجو'];
    return `🍇 الفاكهة السرية كانت: ${fruits[Math.floor(Math.random() * fruits.length)]}`;
  },
  '.تخمين_اللون': () => {
    const colors = ['أحمر', 'أزرق', 'أخضر', 'أصفر', 'بنفسجي', 'وردي', 'أسود', 'أبيض'];
    return `🎨 اللون السري كان: ${colors[Math.floor(Math.random() * colors.length)]}`;
  },
  '.احزر_العلم': () => {
    const flags = [
      { e: '🇯🇵', c: 'اليابان' }, { e: '🇫🇷', c: 'فرنسا' }, { e: '🇧🇷', c: 'البرازيل' },
      { e: '🇪🇬', c: 'مصر' }, { e: '🇰🇷', c: 'كوريا الجنوبية' }, { e: '🇹🇷', c: 'تركيا' },
    ];
    const pick = flags[Math.floor(Math.random() * flags.length)];
    return `${pick.e}\nهاد علم أي دولة؟\n\nالإجابة: ${pick.c}`;
  },
  '.احزر_العاصمة': () => {
    const caps = [
      'عاصمة إيطاليا؟ → روما', 'عاصمة ألمانيا؟ → برلين', 'عاصمة إسبانيا؟ → مدريد',
      'عاصمة الأردن؟ → عمّان', 'عاصمة لبنان؟ → بيروت', 'عاصمة السعودية؟ → الرياض',
    ];
    return `🏛️ ${caps[Math.floor(Math.random() * caps.length)]}`;
  },
};


// ==== 🌟 دفعة ثانية من بنك المحتوى: 50 أمر إضافي ====
const newContentBank2 = {
  ".اقتباس_عمل": ["العمل الجاد بيهزم الموهبة الكسولة.", "لا يوجد نجاح بدون تعب وصبر.", "ابدأ من حيث أنت، استخدم اللي عندك، اعمل اللي تقدر عليه.", "أفضل استثمار هو استثمارك بنفسك.", "الإنجاز الكبير مجموع إنجازات صغيرة يومية."],
  ".اقتباس_وقت": ["الوقت أثمن من الذهب، لأنك ما فيك تشتريه.", "لا تؤجل عمل اليوم لبكرا.", "كل دقيقة بتضيعها ما بترجع.", "استثمر وقتك متل ما بتستثمر فلوسك.", "الوقت الضائع ما بيتعوض."],
  ".اقتباس_تغيير": ["التغيير بيبلش بقرار واحد بسيط.", "لو ما غيرت شي، رح يضل نفس الشي.", "الخوف من التغيير أصعب من التغيير نفسه.", "كل نهاية هي بداية جديدة بشكل تاني.", "التغيير الحقيقي بيبلش من جوا."],
  ".اقتباس_ايمان": ["الإيمان بالنفس نص طريق النجاح.", "من آمن بحلمه، وصل له عاجلاً أم آجلاً.", "الثقة بالله وبالنفس تهزم أي خوف.", "الإيمان يحرّك الجبال.", "من يؤمن بقدراته، يفعل المستحيل."],
  ".اقتباس_احلام": ["الأحلام الكبيرة تحتاج شجاعة كبيرة.", "لا تخف تحلم كبير، الخوف من الحلم أخطر من الفشل فيه.", "كل إنجاز عظيم كان يوماً حلم صغير.", "احلم، خطط، ونفّذ.", "الأحلام بلا خطة تبقى مجرد أمنيات."],
  ".حكمة_يابانية": ["اسقط سبع مرات، انهض ثماني.", "لا تخف من التقدم البطيء، خف من الوقوف مكانك.", "المعلم يفتح الباب، أنت من يدخل.", "الصبر قوة.", "الماء الهادئ يجري عميقاً."],
  ".حكمة_افريقية": ["لو بدك تمشي بسرعة، امشي لحالك، لو بدك توصل بعيد، امشوا سوا.", "الشجرة القوية بتنكسر بالريح، القصبة بتنحني وتنجو.", "من يزرع الرياح يحصد العاصفة.", "القرية الواحدة بتربي الطفل.", "الصبر مفتاح كل الأبواب."],
  ".حكمة_هندية": ["العقل الهادئ يجد الحلول بسرعة.", "من يعرف نفسه، يعرف العالم.", "الحياة رحلة، مو وجهة.", "السلام الداخلي أثمن كنز.", "من يسيطر على غضبه، يسيطر على أكبر عدو."],
  ".اقوال_مشاهير": ["الخيال أهم من المعرفة — أينشتاين.", "النجاح هو الانتقال من فشل لفشل بلا فقدان الحماس — تشرشل.", "كن التغيير اللي بدك تشوفه بالعالم — غاندي.", "الحياة إما مغامرة جريئة أو لا شي — هيلين كيلر.", "لا تنتظر الفرصة، اخلقها — جورج برنارد شو."],
  ".اقتباس_عائلة": ["العائلة هي أول وآخر ملجأ بالحياة.", "بيت العائلة أدفى مكان بالعالم.", "العائلة مو مجرد أهم شي، هي كل شي.", "الحب الحقيقي بيبلش من البيت.", "العائلة هي الجذور اللي بتخليك واقف بأي عاصفة."],
  ".معلومة_جسم_الانسان": ["القلب بيضخ حوالي 7500 لتر دم باليوم.", "العين البشرية فيها حوالي 120 مليون خلية مستقبلة للضوء.", "الكبد عضو قادر على تجديد نفسه جزئياً.", "أقوى عضلة بالجسم نسبة لحجمها هي عضلة الفك.", "الجلد أكبر عضو بجسم الإنسان."],
  ".معلومة_بحار": ["المحيط الهادئ أكبر محيط بالعالم.", "أعمق نقطة بالمحيطات هي خندق ماريانا.", "أغلب سطح الأرض مغطى بالمي.", "الشعاب المرجانية بتضم آلاف الأنواع من الكائنات.", "المحيطات بتنتج جزء كبير من الأكسجين اللي بنتنفسه."],
  ".معلومة_طيور": ["النعامة أكبر طير بالعالم بس ما بتطير.", "بعض الطيور بتقدر تطير آلاف الكيلومترات بالهجرة.", "الببغاء بيقدر يقلد أصوات وكلام.", "البوم بيقدر يلف راسه لدرجة كبيرة.", "طائر الطنان الوحيد اللي بيقدر يطير للخلف."],
  ".معلومة_نبات": ["بعض النباتات بتعيش آلاف السنين.", "النباتات بتنتج الأكسجين عن طريق التمثيل الضوئي.", "بعض الأشجار بتتواصل مع بعضها عن طريق جذورها.", "الصبار بيقدر يخزن مي لفترات طويلة.", "أكبر زهرة بالعالم حجمها ممكن يوصل لأكتر من متر."],
  ".معلومة_طقس": ["البرق أسخن من سطح الشمس لجزء من الثانية.", "أسرع رياح مسجلة كانت بإعصار.", "الثلج بيتكون من بلورات ماء متجمدة.", "قوس قزح بيصير لما الضوء ينكسر بقطرات المي.", "بعض المناطق ما بتشوف مطر لسنين متواصلة."],
  ".هل_تعلم_جغرافي": ["هل تعلم إنه روسيا بتمتد عبر 11 منطقة زمنية؟", "هل تعلم إنه الصحراء الكبرى تقريباً بحجم قارة كاملة؟", "هل تعلم إنه إندونيسيا فيها آلاف الجزر؟", "هل تعلم إنه نهر الأمازون بيحمل أكبر كمية مي بالعالم؟", "هل تعلم إنه جبال الهيمالايا لسا عم تكبر؟"],
  ".هل_تعلم_رياضي": ["هل تعلم إنه الصفر اخترع كرقم بحضارات قديمة زي الهند؟", "هل تعلم إنه كل رقم أولي عدا 2 هو رقم فردي؟", "هل تعلم إنه مجموع أول 100 رقم = 5050؟", "هل تعلم إنه الدائرة إلها زوايا لا نهائية؟", "هل تعلم إنه رقم پاي (π) ما بينتهي؟"],
  ".اختراع_مفيد": ["الثلاجة غيّرت طريقة حفظ الطعام للأبد.", "السيارة سهّلت التنقل بشكل كبير.", "الساعة ساعدت البشر ينظموا وقتهم.", "النظارات ساعدت ملايين الناس يشوفوا أفضل.", "المضخة المائية سهّلت الوصول للمي النظيف."],
  ".معلومة_رقمية": ["أول كمبيوتر كان بحجم غرفة كاملة تقريباً.", "الإنترنت بدأ كمشروع عسكري بأمريكا.", "أول رسالة نصية أُرسلت سنة 1992.", "أول موقع إلكتروني لسا موجود وشغال لليوم.", "الكمبيوترات الحديثة أسرع بملايين المرات من أول كمبيوتر."],
  ".معلومة_فنون": ["لوحة الموناليزا من أشهر اللوحات بالتاريخ.", "الموسيقى الكلاسيكية بتأثر على المزاج والتركيز.", "أول فيلم سينمائي كان صامت بدون صوت.", "الرسم بالكهوف يعتبر من أقدم أشكال الفن.", "المسرح اليوناني القديم أثّر بشكل كبير على الفن الحديث."],
  ".عبارة_زواج": ["الزواج شراكة قبل ما يكون علاقة.", "أساس الزواج الناجح هو الاحترام المتبادل.", "الزواج الحقيقي بيكبر بالصعاب مو بس بالفرح.", "شريك الحياة الصح بيخليك أحسن نسخة من حالك.", "الزواج مش نهاية القصة، هو بداية فصل جديد."],
  ".عبارة_اخوة": ["الأخوة كنز ما بيتعوض.", "الأخ الحقيقي بيوقف جنبك بأصعب اللحظات.", "الدم أقوى من أي شي بالحياة.", "الأخوة صداقة عمرها من عمرك.", "مافي حدا بيعرفك متل أخوك."],
  ".عبارة_غربة": ["الغربة صعبة، بس بتعلمك تقدّر وطنك أكتر.", "بعيد عن الأهل، قريب بالقلب.", "الغربة بتقوي الإنسان بطرق ما كان يتوقعها.", "كل غريب بيحمل شوق ما حدا شايفه.", "الوطن دايماً بالقلب مهما بعدت المسافة."],
  ".عبارة_نجاح_شخصي": ["نجاحك اليوم نتيجة تعبك بالأمس.", "افتخر بكل خطوة وصلتلها، مهما كانت صغيرة.", "النجاح الحقيقي هو رضاك عن نفسك.", "أنت أثبت إنك قادر، استمر.", "كل إنجاز يستاهل الاحتفال فيه."],
  ".عبارة_امل_جديد": ["كل صباح فرصة جديدة تبدأ فيها من الصفر.", "الأمل بيولد من جديد كل يوم.", "لا تفقد الأمل، الأفضل لسا جاي.", "غداً حمّال أوجه، خليك متفائل.", "الأمل هو الوقود اللي بيخلينا نكمل."],
  ".تحية_عيد": ["كل عام وأنتم بخير 🎉", "عيدكم مبارك وكل سنة وأنتم طيبين 🌙", "أعاده الله عليكم باليمن والبركات ✨", "عيد سعيد ملي بالفرح والصحة 🎊", "تقبل الله منا ومنكم صالح الأعمال 🤲"],
  ".تهنئة_نجاح": ["مبروك عليك النجاح، تستاهل كل خير! 🎉", "ألف مبروك، تعبك أثمر! 🏆", "فخورين فيك، استمر بنفس الطريق! 💪", "مبروك الإنجاز، إنت تستاهل الأفضل دايماً! 🌟", "الله يبارك فيك ويوفقك لأكتر! 🎊"],
  ".تهنئة_مولود": ["الله يبارك بالمولود ويحفظه لكم 👶", "مبروك المولود الجديد، عقبال الأفراح دايماً! 🎉", "الله يجعله من مواليد السعادة والبركة 🌸", "مبروك، أهلاً وسهلاً بالضيف الجديد! 👼", "بالرفاه والبنين، الله يحفظه لكم 💐"],
  ".رسالة_عيد_ميلاد": ["كل عام وأنت بخير، عقبال 100 سنة! 🎂", "عيد ميلاد سعيد، يومك يكون مليان فرح! 🎉", "أتمنالك سنة مليانة نجاح وسعادة 🎈", "كل سنة وأنت أقرب لأحلامك 🌟", "عيد ميلاد مبارك، ربنا يحقق كل أمانيك 🎁"],
  ".عبارة_تفاؤل_يومي": ["اليوم هيك، وبكرا رح يكون أحلى.", "خلي طاقتك اليوم إيجابية، الكون بيرد نفس الطاقة.", "ابتسم، اليوم يستاهل ابتسامتك.", "كل يوم فرصة جديدة تبدأ فيها من جديد.", "طاقتك اليوم بتحدد شكل يومك، خليها حلوة."],
  ".طاقتك_اليوم": ["طاقتك اليوم عالية جداً، استغلها!", "طاقتك اليوم هادية، وقت مناسب للراحة.", "طاقتك اليوم إبداعية، اطلق العنان لأفكارك.", "طاقتك اليوم اجتماعية، اقضي وقت مع ناس بتحبهم.", "طاقتك اليوم تحليلية، وقت مناسب لقرارات مهمة."],
  ".رقم_شخصيتك": ["رقم شخصيتك: 7 — عميق ومحلل.", "رقم شخصيتك: 3 — اجتماعي ومبدع.", "رقم شخصيتك: 1 — قيادي ومستقل.", "رقم شخصيتك: 9 — إنساني وكريم.", "رقم شخصيتك: 5 — مغامر وحر."],
  ".نصيحة_فلكية": ["النجوم بتنصحك تاخد قرار مهم بهدوء اليوم.", "وقت مناسب للتركيز على نفسك أكتر من غيرك.", "النجوم بتقول: الصبر رح يجيب ثماره قريباً.", "وقت جيد لتقوية علاقاتك الاجتماعية.", "النجوم بتنصحك تاخد استراحة وتعيد شحن طاقتك."],
  ".نوعك_الشخصي": ["أنت من النوع القيادي اللي بياخد المبادرة.", "أنت من النوع الهادئ اللي بيفكر قبل ما يتصرف.", "أنت من النوع الاجتماعي اللي بيحب يكون محاط بالناس.", "أنت من النوع المبدع اللي دايماً عنده أفكار جديدة.", "أنت من النوع المحلل اللي بيحب يفهم كل التفاصيل."],
  ".مهنتك_المثالية": ["مهنتك المثالية: قائد فريق أو مدير مشروع.", "مهنتك المثالية: فنان أو مصمم مبدع.", "مهنتك المثالية: باحث أو محلل بيانات.", "مهنتك المثالية: معالج نفسي أو مستشار.", "مهنتك المثالية: رائد أعمال مستقل."],
  ".عاصمتك_الروحية": ["عاصمتك الروحية: باريس — رومانسية وفن.", "عاصمتك الروحية: طوكيو — نظام وابتكار.", "عاصمتك الروحية: القاهرة — عراقة وحيوية.", "عاصمتك الروحية: نيويورك — طموح وسرعة.", "عاصمتك الروحية: دبي — فخامة وطموح."],
  ".فصلك_المفضل": ["شخصيتك تناسب الربيع — تجدد وأمل.", "شخصيتك تناسب الصيف — حيوية وحماس.", "شخصيتك تناسب الخريف — هدوء وتأمل.", "شخصيتك تناسب الشتاء — عمق وتركيز.", "شخصيتك متوازنة بين كل الفصول."],
  ".عنصرك": ["عنصرك: النار — حماس وقوة.", "عنصرك: الماء — هدوء وعمق مشاعر.", "عنصرك: الهواء — حرية وأفكار متجددة.", "عنصرك: التراب — ثبات وواقعية.", "عنصرك مزيج بين النار والماء — توازن مميز."],
  ".نوع_قائدك_الداخلي": ["قائدك الداخلي حكيم وهادئ.", "قائدك الداخلي جريء ومقدام.", "قائدك الداخلي مبدع وملهم.", "قائدك الداخلي منظم ومخطط.", "قائدك الداخلي متعاطف ومستمع جيد."],
  ".حظك_بالعلاقات": ["حظك بالعلاقات هالفترة إيجابي جداً.", "علاقاتك رح تتقوى هالفترة.", "وقت مناسب تفتح صفحة جديدة بعلاقاتك.", "حظك بالحب هالفترة واعد.", "علاقاتك الاجتماعية رح توسع هالفترة."],
  ".سؤال_طفولة": ["شو أحلى ذكرى من طفولتك؟", "شو كنت بدك تصير لما تكبر؟", "شو أكتر لعبة كنت تحبها بطفولتك؟", "مين كان صديقك المفضل بطفولتك؟", "شو أكتر شي كنت تخاف منه صغير؟"],
  ".سؤال_مستقبل": ["وين بتشوف نفسك بعد 10 سنين؟", "شو أهم هدف بدك تحققه بحياتك؟", "لو فيك تتعلم مهارة جديدة، شو بتختار؟", "شو حلمك الكبير اللي لسا ما حققته؟", "لو فيك تعيش بأي بلد، وين بتختار؟"],
  ".سؤال_اختيار": ["لو خيروك بين الجبل أو البحر، وين بتروح؟", "لو خيروك بين القراءة أو المشاهدة، شو بتختار؟", "لو خيروك بين الصيف أو الشتاء، شو بتفضل؟", "لو خيروك بين القهوة أو الشاي، شو بتختار؟", "لو خيروك بين السفر لوحدك أو مع رفقة، شو بتختار؟"],
  ".سؤال_راي": ["شو رأيك بأهمية التعليم بحياة الإنسان؟", "شو رأيك بتأثير السوشال ميديا على الناس؟", "شو رأيك بأهمية الوقت مع العائلة؟", "شو رأيك بأهمية السفر لتوسيع الأفق؟", "شو رأيك بأهمية الصحة النفسية؟"],
  ".سؤال_تحدي_شخصي": ["شو أصعب تحدي واجهته وتخطيته؟", "شو أكتر شي فخور فيه بنفسك؟", "شو الدرس الأهم تعلمته من فشل معين؟", "شو أكتر قرار غيّر مجرى حياتك؟", "شو أكتر شي ساعدك تتخطى وقت صعب؟"],
  ".سؤال_امتنان": ["شو أكتر شي ممتن له اليوم؟", "مين أكتر شخص ممتن لوجوده بحياتك؟", "شو أكتر نعمة بتحس فيها كل يوم؟", "شو أكتر لحظة خلتك تحس بالامتنان؟", "شو أكتر شي بسيط بيسعدك بيومك؟"],
  ".سؤال_تخيل": ["لو قدرت تطير ليوم واحد، وين بتروح؟", "لو صار عندك قوة خارقة، شو بتختار؟", "لو قدرت تعيش بأي عصر تاريخي، شو بتختار؟", "لو قدرت تحكي مع أي شخصية تاريخية، مين بتختار؟", "لو قدرت توقف الوقت لساعة، شو بتسوي فيها؟"],
  ".سؤال_اهتمامات": ["شو أكتر موضوع بتحب تتعلم عنه؟", "شو هوايتك اللي بتخليك تنسى الوقت؟", "شو أكتر نشاط بيريحك نفسياً؟", "شو نوع الموسيقى اللي بتفضلها؟", "شو أكتر رياضة بتحب تتابعها أو تمارسها؟"],
  ".سؤال_قيم": ["شو أهم قيمة برأيك لازم يتربى عليها الإنسان؟", "شو رأيك بأهمية الصدق بالعلاقات؟", "شو أهم درس تعلمته من أهلك؟", "شو برأيك أهم صفة بالصديق الحقيقي؟", "شو القيمة اللي ما فيك تتنازل عنها أبداً؟"],
  ".سؤال_يوم_مثالي": ["كيف بيبدو يومك المثالي من الصبح للمسا؟", "لو فيك تخطط يوم كامل بلا مسؤوليات، كيف بيكون؟", "شو أول شي بتسويه بيوم إجازتك؟", "مع مين بتحب تقضي يومك المثالي؟", "وين بيكون يومك المثالي؟ بالبيت ولا برا؟"],
};

// ==== 🧰 دفعة ثانية من الأدوات الحقيقية ====
const mathUtilCommands2 = {
  '.متوسط_هندسي': (a) => {
    const nums = a.map(Number).filter((n) => !isNaN(n) && n > 0);
    if (nums.length === 0) return '⚠️ اكتب أرقام موجبة، مثال: .متوسط_هندسي 4 9';
    const product = nums.reduce((p, n) => p * n, 1);
    return `📊 المتوسط الهندسي: ${Math.pow(product, 1 / nums.length).toFixed(2)}`;
  },
  '.فرق_رقمين': (a) => {
    const x = parseFloat(a[0]), y = parseFloat(a[1]);
    if (isNaN(x) || isNaN(y)) return '⚠️ مثال: .فرق_رقمين 10 4';
    return `➖ الفرق: ${Math.abs(x - y)}`;
  },
  '.حاصل_جمع': (a) => {
    const nums = a.map(Number).filter((n) => !isNaN(n));
    if (nums.length === 0) return '⚠️ اكتب أرقام مفصولة بمسافة';
    return `➕ المجموع: ${nums.reduce((s, n) => s + n, 0)}`;
  },
  '.حاصل_ضرب': (a) => {
    const nums = a.map(Number).filter((n) => !isNaN(n));
    if (nums.length === 0) return '⚠️ اكتب أرقام مفصولة بمسافة';
    return `✖️ حاصل الضرب: ${nums.reduce((p, n) => p * n, 1)}`;
  },
  '.تقريب_رقم': (a) => {
    const n = parseFloat(a[0]);
    if (isNaN(n)) return '⚠️ مثال: .تقريب_رقم 7.6';
    return `🔢 ${n} مقرب = ${Math.round(n)}`;
  },
  '.تحويل_ميل_كم': (a) => {
    const miles = parseFloat(a[0]);
    if (isNaN(miles)) return '⚠️ مثال: .تحويل_ميل_كم 5';
    return `🛣️ ${miles} ميل = ${(miles * 1.60934).toFixed(2)} كم`;
  },
  '.تحويل_كم_ميل': (a) => {
    const km = parseFloat(a[0]);
    if (isNaN(km)) return '⚠️ مثال: .تحويل_كم_ميل 10';
    return `🛣️ ${km} كم = ${(km / 1.60934).toFixed(2)} ميل`;
  },
  '.تحويل_باوند_كيلو': (a) => {
    const lb = parseFloat(a[0]);
    if (isNaN(lb)) return '⚠️ مثال: .تحويل_باوند_كيلو 150';
    return `⚖️ ${lb} باوند = ${(lb * 0.453592).toFixed(2)} كيلوغرام`;
  },
  '.تحويل_كيلو_باوند': (a) => {
    const kg = parseFloat(a[0]);
    if (isNaN(kg)) return '⚠️ مثال: .تحويل_كيلو_باوند 70';
    return `⚖️ ${kg} كيلوغرام = ${(kg / 0.453592).toFixed(2)} باوند`;
  },
  '.مساحة_مثلث': (a) => {
    const base = parseFloat(a[0]), h = parseFloat(a[1]);
    if (isNaN(base) || isNaN(h)) return '⚠️ مثال: .مساحة_مثلث 6 4';
    return `🔺 مساحة المثلث = ${(0.5 * base * h).toFixed(2)}`;
  },
  '.محيط_مستطيل': (a) => {
    const l = parseFloat(a[0]), w = parseFloat(a[1]);
    if (isNaN(l) || isNaN(w)) return '⚠️ مثال: .محيط_مستطيل 5 3';
    return `▭ محيط المستطيل = ${2 * (l + w)}`;
  },
  '.محيط_مربع': (a) => {
    const s = parseFloat(a[0]);
    if (isNaN(s)) return '⚠️ مثال: .محيط_مربع 4';
    return `◻️ محيط المربع = ${4 * s}`;
  },
  '.نظرية_فيثاغورس': (a) => {
    const a1 = parseFloat(a[0]), b1 = parseFloat(a[1]);
    if (isNaN(a1) || isNaN(b1)) return '⚠️ مثال: .نظرية_فيثاغورس 3 4';
    return `📐 الوتر = ${Math.sqrt(a1 * a1 + b1 * b1).toFixed(2)}`;
  },
  '.عد_تنازلي_ارقام': (a) => {
    const n = parseInt(a[0], 10);
    if (isNaN(n) || n < 1 || n > 30) return '⚠️ اكتب رقم من 1 لـ30، مثال: .عد_تنازلي_ارقام 5';
    const seq = [];
    for (let i = n; i >= 1; i--) seq.push(i);
    return `⏬ ${seq.join(' - ')}`;
  },
  '.اكبر_من_قائمة': (a) => {
    const nums = a.map(Number).filter((n) => !isNaN(n));
    if (nums.length < 2) return '⚠️ اكتب رقمين ع الأقل';
    const sorted = [...nums].sort((x, y) => y - x);
    return `🏅 مرتبين تنازلياً: ${sorted.join(', ')}`;
  },
  '.اصغر_من_قائمة': (a) => {
    const nums = a.map(Number).filter((n) => !isNaN(n));
    if (nums.length < 2) return '⚠️ اكتب رقمين ع الأقل';
    const sorted = [...nums].sort((x, y) => x - y);
    return `🏅 مرتبين تصاعدياً: ${sorted.join(', ')}`;
  },
  '.عدد_الاحرف_العربية': (a) => {
    const t = a.join(' ');
    if (!t) return '⚠️ اكتب نص';
    const count = (t.match(/[\u0600-\u06FF]/g) || []).length;
    return `🔤 عدد الأحرف العربية: ${count}`;
  },
  '.اول_حرف_كبير': (a) => {
    const t = a.join(' ');
    if (!t) return '⚠️ اكتب نص إنجليزي';
    return t.replace(/\b\w/g, (c) => c.toUpperCase());
  },
  '.تكرار_نص': (a) => {
    const times = parseInt(a[0], 10);
    const text = a.slice(1).join(' ');
    if (isNaN(times) || times < 1 || times > 20 || !text) return '⚠️ مثال: .تكرار_نص 3 مرحبا';
    return Array(times).fill(text).join(' ');
  },
  '.تحويل_درجة_حرارة_مئوي_فهرنهايت': (a) => {
    const c = parseFloat(a[0]);
    if (isNaN(c)) return '⚠️ مثال: .تحويل_درجة_حرارة_مئوي_فهرنهايت 30';
    return `🌡️ ${c}°C = ${((c * 9) / 5 + 32).toFixed(1)}°F`;
  },
};


// ==== 🎮 دفعة ثانية من الألعاب السريعة ====
const quickGameCommands2 = {
  '.سؤال_افلام': () => {
    const qs = [
      'أول فيلم أنيميشن طويل بالتاريخ؟ → سنو وايت',
      'أطول سلسلة أفلام سوبر هيروز؟ → مارفل',
      'كم جزء بسلسلة هاري بوتر السينمائية؟ → 8 أجزاء',
    ];
    return `🎬 ${qs[Math.floor(Math.random() * qs.length)]}`;
  },
  '.سؤال_موسيقى': () => {
    const qs = [
      'كم وتر بالجيتار العادي؟ → 6 أوتار',
      'شو اسم آلة البيانو بالعربي؟ → البيانو (آلة وترية إيقاعية)',
      'كم مفتاح أسود بالأوكتاف الواحد بالبيانو؟ → 5 مفاتيح',
    ];
    return `🎵 ${qs[Math.floor(Math.random() * qs.length)]}`;
  },
  '.تخمين_الرقم_السري': () => {
    const secret = Math.floor(Math.random() * 10) + 1;
    return `🔢 رقمك السري لهاي الجولة كان: ${secret} (من 1 لـ10) — جرب تحزر المرة الجاية!`;
  },
  '.دوران_السهم': () => {
    const dirs = ['⬆️ شمال', '➡️ شرق', '⬇️ جنوب', '⬅️ غرب', '↗️ شمال شرق', '↘️ جنوب شرق'];
    return `🧭 السهم أشار لـ: ${dirs[Math.floor(Math.random() * dirs.length)]}`;
  },
  '.اختبار_سرعة_البديهة': () => {
    const a = Math.floor(Math.random() * 12) + 1, b = Math.floor(Math.random() * 12) + 1;
    return `⚡ بسرعة: كم حاصل ${a} × ${b}؟\n\nالإجابة: ${a * b}`;
  },
  '.مين_احتمال_يفوز': () => {
    const pct = Math.floor(Math.random() * 100) + 1;
    return `📊 احتمالية الفوز اليوم: ${pct}%`;
  },
  '.كرة_السحر': () => {
    const answers = ['أكيد! 🔮', 'الاحتمال ضعيف', 'اسأل مرة تانية بكرا', 'الوضع غامض حالياً', 'نعم بدون شك!', 'لأ للأسف'];
    return `🔮 الكرة السحرية تقول: ${answers[Math.floor(Math.random() * answers.length)]}`;
  },
  '.تحدي_الحفظ': () => {
    const seq = Array.from({ length: 4 }, () => Math.floor(Math.random() * 9) + 1).join('-');
    return `🧠 احفظ هالتسلسل بسرعة: ${seq}\n(بعد 5 ثواني جرب تكتبه من ذاكرتك!)`;
  },
  '.دولة_عشوائية': () => {
    const countries = ['مصر', 'اليابان', 'البرازيل', 'كندا', 'إيطاليا', 'الهند', 'المغرب', 'كوريا الجنوبية', 'تركيا', 'الأرجنتين'];
    return `🌍 دولة اليوم العشوائية: ${countries[Math.floor(Math.random() * countries.length)]}`;
  },
  '.اسم_عشوائي': () => {
    const names = ['ياسمين', 'عمر', 'ليلى', 'كريم', 'سارة', 'زياد', 'نور', 'طارق', 'رهف', 'مالك'];
    return `👤 اسم عشوائي: ${names[Math.floor(Math.random() * names.length)]}`;
  },
  '.مهنة_عشوائية': () => {
    const jobs = ['طبيب', 'مهندس', 'معلم', 'رائد فضاء', 'طباخ محترف', 'كاتب', 'مصور', 'مبرمج', 'موسيقي', 'مصمم'];
    return `💼 مهنتك العشوائية اليوم: ${jobs[Math.floor(Math.random() * jobs.length)]}`;
  },
  '.قوة_خارقة_عشوائية': () => {
    const powers = ['الطيران ✈️', 'قراءة الأفكار 🧠', 'السرعة الخارقة ⚡', 'التخفي 👻', 'التحكم بالوقت ⏳', 'قوة خارقة جسدية 💪'];
    return `🦸 قوتك الخارقة اليوم: ${powers[Math.floor(Math.random() * powers.length)]}`;
  },
  '.شخصية_تاريخية_عشوائية': () => {
    const figs = ['ابن سينا', 'كليوباترا', 'صلاح الدين الأيوبي', 'ابن خلدون', 'الخوارزمي', 'ابن بطوطة'];
    return `📜 شخصية اليوم التاريخية: ${figs[Math.floor(Math.random() * figs.length)]}`;
  },
  '.وجهة_سفر_عشوائية': () => {
    const dest = ['باريس 🗼', 'طوكيو 🗾', 'دبي 🏙️', 'روما 🏛️', 'بالي 🏝️', 'إسطنبول 🕌', 'نيويورك 🌆'];
    return `✈️ وجهة سفرك المقترحة: ${dest[Math.floor(Math.random() * dest.length)]}`;
  },
  '.تحدي_رياضي_سريع': () => {
    const c = ['اعمل 10 ضغط دلوقتي!', 'اقفز مكانك 15 مرة!', 'امسك وضعية بلانك لمدة 20 ثانية!', 'اركض مكانك لمدة 15 ثانية!'];
    return `🏃 تحدي رياضي: ${c[Math.floor(Math.random() * c.length)]}`;
  },
};


const morseMap = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--',
  '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
};

// ==== خريطة تفاعل إيموجي لكل أمر (رياكشن على رسالة المرسل) ====
const commandReactions = {
  '.مرحبا': '👋', hi: '👋',
  '.مساعدة': '📋', '.help': '📋', '.مساعدة_نص': '📋',
  '.الوقت': '🕐',
  '.ping': '🏓', '.سرعة': '🏓', '.تنظيف': '🧹',
  '.ستيكر': '🖼️', '.sticker': '🖼️', '.صورة': '🎬', '.استخراج_صوت': '🎧', '.صوت_من_فيديو': '🎧',
  '.تشغيل': '🎵', '.شغل': '🎵', '.play': '🎵',
  '.فيديو': '🎬', '.video': '🎬',
  '.بنترست': '📌', '.pinterest': '📌',
  '.apk': '📦', '.حزمة': '🎨',
  '.اقتباس': '💬',
  '.الطقس': '🌤️', '.اسأل': '🤖', '.ai': '🤖', '.كلود': '✨', '.حلل_صورة': '🖼️', '.مسح_الذاكرة': '🧹', '.بحث_ذكي': '🔎',
  '.كوتتي': '📊', '.تصفير_كوتا': '🔄', '.اذاعة': '📢', '.بث': '📢',
  '.تعليم': '📚', '.نسيان': '🗑️', '.معرفتي': '📋', '.بوتي': '🤖',
  '.تحدث': '🎙️', '.رد_صوتي': '🎙️', '.نطق': '🔊', '.صوت': '🔊',
  '.تحويل_عملة': '💱', '.بحث': '📖', '.تاريخ_هجري': '🌙',
  '.تذكير_يومي': '🔁', '.تذكيراتي': '📋', '.الغاء_تذكير': '🗑️',
  '.ترجم': '🌍', '.لخص': '📝', '.صحح': '✍️', '.حاسبة': '🧮', '.qr': '📱', '.اختصار_رابط': '🔗',
  '.اكتب_كود': '💻', '.كود': '💻', '.حلل_ملف': '📄',
  '.معلومات_القروب': 'ℹ️', '.احصائيات': '📊',
  '.قائمة_الادمن': '👮',
  '.تخمين': '🎯', '.سؤال': '🧠', '.حساب': '🧮', '.فك_الكلمة': '🔤',
  '.صراحة': '💎', '.دخول_صراحة': '🙋', '.انضم_صراحة': '🙋', '.شغل_صراحة': '🚀', '.بدء_صراحة': '🚀',
  '.تخطي_صراحة': '⏭️', '.انهاء_صراحة': '🏁',
  '.تثبيت': '📌', '.تثبيت_الرسالة': '📌', '.الغاء_تثبيت': '📌', '.فك_تثبيت': '📌',
  '.اصوات': '🎙️', '.الاصوات': '🎙️',
  '.لغز': '🧩', '.صح_خطأ': '✅', '.تخمين_الدولة': '🚩', '.اكمل_مثل': '📜',
  '.خمن_شخصية': '🧠', '.كلمة_ناقصة': '✏️', '.تصنيف': '🔠', '.قائمة_الالعاب': '🎮',
  '.نقاطي': '🏅', '.نقاط': '🏅', '.الترتيب': '🏆', '.المتصدرين': '🏆', '.الجوائز': '🎁',
  '.هدية_يومية': '🎁', '.مكافأة_يومية': '🎁',
  '.المتصدرين_الاسبوع': '🏆', '.الترتيب_الاسبوعي': '🏆', '.ارشيف_الابطال': '📜', '.ارشيف_الاسبوع': '📜',
  '.المتجر': '🛒', '.متجر_النقاط': '🛒', '.متجر_المافيا': '🦠', '.شراء': '🛍️', '.تفعيل_وسام': '🎖️', '.تفعيل_اطار': '🖼️', '.مقتنياتي': '🎒', '.بروفايلي': '👤', '.بروفايل': '👤', '.بطاقتي': '💳', '.بطاقة_بنكية': '💳', '.بنك_امونس': '💳',
  '.تفعيل_حيوان': '🐾', '.حيواناتي': '🐾',
  '.عرض_اليوم': '🏷️', '.بدء_مزاد': '🔨', '.مزاد': '🔨', '.مزايدة': '💰',
  '.مبارزة': '⚔️', '.هجوم': '⚔️', '.دفاع': '🛡️', '.شفاء': '💚', '.متجر_المعركة': '🛒', '.شراء_معركة': '🛍️', '.بدء_حرب': '💀', '.انضم': '🙋', '.حالة_الحرب': '📋', '.الغاء_حرب': '❌',
  '.برج_التحدي': '🏰', '.انسحاب_البرج': '🏃', '.عجلة_الحظ': '🎡',
  '.فعالية': '🎉', '.انهاء_الفعالية': '🛑', '.المطور': '👨‍💻', '.تواصل': '👨‍💻',
  '.قناتنا': '📢', '.قناتي': '📢', '.القناة': '📢',
  '.استسلم': '🏳️', '.تحدي': '⚔️', '.اختر': '✊',
  '.اكس_او': '⭕', '.xo': '⭕', '.حرك': '🎯',
  '.مشنقة': '🎯', '.استسلام_مشنقة': '🏳️', '.سلسلة_كلمات': '🔗', '.انهاء_سلسلة': '🏁',
  '.عملة': '🪙', '.نرد': '🎲', '.سباق': '🏃',
  '.حظ': '🍀', '.نكتة': '😂', '.لون': '🎨', '.اسم_مستعار': '🎭',
  '.توقع': '🔮', '.تقييم': '⭐', '.توافق': '💞', '.قرعة': '🎯',
  '.اختر_عشوائي': '🎯', '.عكس': '🔁', '.تشفير': '🔐', '.فك_تشفير': '🔓',
  '.مورس': '📡', '.عد_الاحرف': '📏', '.عمر': '🎂', '.يوم': '📅',
  '.تحويل_طول': '📐', '.تحويل_وزن': '⚖️', '.تحويل_حرارة': '🌡️',
  '.تصويت': '🗳️', '.تذكير': '⏰',
  '.اضف_صلاة': '🕌', '.حذف_صلاة': '🕌', '.صلوات': '🕌',
  '.تفعيل_الصلاة_على_النبي': '🌙', '.تعطيل_الصلاة_على_النبي': '🌙',
  '.اذكار': '📿', '.ذكر': '📿', '.تفعيل_الاذكار': '📿', '.تعطيل_الاذكار': '📿',
  '.كيك': '🚫', '.طرد': '🚫', '.ترقية': '👑', '.تنزيل': '⬇️', '.كيك_الكل': '🚫', '.الحماية_الشاملة': '🛡️✨', '.الغاء_حظر_الكل': '🧹',
  '.كتم': '🔇', '.الغاء_كتم': '🔊', '.الوضع_البطيء': '🐢', '.الغاء_البطيء': '🐇',
  '.وظيفة': '💼', '.اشتغل': '💰', '.استثمار': '📈', '.سيرتي': '📝', '.انجازاتي': '🏆',
  '.مافيا_ابدأ': '🕵️', '.مافيا_يلا': '🕵️', '.مافيا_فردي': '🧍', '.مافيا_بدء_الآن': '⚡', '.مافيا_انضم': '👤', '.مافيا_الغاء': '🛑', '.قتل': '🔪', '.حماية': '💊', '.تحقيق': '🔍', '.قنص': '🎯', '.تهريب': '🕴️', '.تصويت': '🗳️', '.الغاء_تصويت': '↩️',
  '.زواج': '💍', '.قبول_الزواج': '💒', '.رفض_الزواج': '💔', '.طلاق': '💔', '.زوجي': '💑', '.شريكي': '💑',
  '.وضع_الموافقة': '🚪', '.قبول_عضو': '✅', '.رفض_عضو': '❌',
  '.قفل': '🔒', '.فتح': '🔓',
  '.حظر': '🚫', '.رفع_حظر': '✅', '.قائمة_المحظورين': '📋',
  '.اسم_القروب': '📛', '.وصف_القروب': '📝', '.رابط': '🔗', '.تحديث_رابط': '🔄',
  '.منشن_الكل': '📢', '.انذار': '⚠️', '.مسح_الانذارات': '🧹',
  '.حماية_الروابط': '🛡️', '.حماية_الالفاظ': '🛡️', '.حماية_السبام': '🛡️', '.حماية_الحذف': '🕵️', '.قفل_الوسائط': '🔒', '.الحماية': '🛡️', '.حالة_الحماية': '🛡️',
  '.حماية_المنشن': '🛡️', '.منع_المنشن': '🚫', '.حماية_التداول': '🛡️', '.حماية_التكرار': '🛡️', '.حد_الانذارات': '⚠️',
  '.ايقاف_البوت': '🔴', '.تشغيل_البوت': '🟢',
};

// ==== 🧹 تنظيف الملفات المؤقتة المتراكمة (أغاني/فيديوهات/ملفات مؤقتة) ====
const BOT_DIR = '/data/data/com.termux/files/home/mybot';

function cleanupTempFiles() {
  let count = 0;
  let totalBytes = 0;
  try {
    const files = fs.readdirSync(BOT_DIR);
    for (const file of files) {
      const isTemp =
        file.startsWith('song_') ||
        file.startsWith('temp_') ||
        file.startsWith('temp_in_') ||
        file.startsWith('temp_out_') ||
        file.startsWith('video_') ||
        /^\d+-player-script\.js$/.test(file) ||
        file.endsWith('.webm') ||
        file.endsWith('.part');

      if (isTemp) {
        const fullPath = `${BOT_DIR}/${file}`;
        try {
          const stats = fs.statSync(fullPath);
          totalBytes += stats.size;
          fs.unlinkSync(fullPath);
          count++;
        } catch (e) {
          // تجاهل لو الملف اتحذف أو صار فيه مشكلة وصول
        }
      }
    }
  } catch (e) {
    console.log('⚠️ خطأ بالتنظيف التلقائي:', e.message);
  }
  return { count, totalMB: (totalBytes / (1024 * 1024)).toFixed(2) };
}

// ==== 🗂 تتبع طلبات تنصيب البوت لأرقام جديدة (self-service) — محفوظة بملف حتى تضل موجودة بعد إعادة التشغيل ====
const ACTIVE_INSTALLS_FILE = '/data/data/com.termux/files/home/mybot/activeinstalls.json';

class PersistentMap extends Map {
  constructor(filePath) {
    super();
    this.filePath = filePath;
  }
  save() {
    saveJSON(this.filePath, Object.fromEntries(this));
  }
  set(key, value) {
    super.set(key, value);
    if (this.filePath) this.save();
    return this;
  }
  delete(key) {
    const result = super.delete(key);
    if (this.filePath) this.save();
    return result;
  }
}

const savedInstalls = loadJSON(ACTIVE_INSTALLS_FILE, {});
const activeInstalls = new PersistentMap(ACTIVE_INSTALLS_FILE); // phoneNumber -> { status, requester }
for (const [phoneDigits, entry] of Object.entries(savedInstalls)) {
  Map.prototype.set.call(activeInstalls, phoneDigits, entry); // تحميل أولي بدون إعادة كتابة الملف بكل عنصر
}

// ==== 🎵 نتائج بحث الأغاني بانتظار اختيار المستخدم (chatId -> { results, requester, timestamp }) ====
const pendingSongSelections = new Map();
const SONG_SELECTION_TIMEOUT_MS = 3 * 60 * 1000; // 3 دقايق مهلة للاختيار
const SONG_SEARCH_COUNT = 1; // نتيجة وحدة بس — تنزيل مباشر بدون قائمة اختيار
const SONG_MAX_DURATION_SEC = 20 * 60; // 20 دقيقة حد أقصى، حتى ما نعلق بتنزيل فيديوهات طويلة جداً

// ==== ✂️ تقصير عنوان طويل لأول 25 حرف + ... ====
function truncateTitle(title, maxLen = 25) {
  if (!title) return '';
  return title.length > maxLen ? title.slice(0, maxLen).trim() + '...' : title;
}

// ==== 🎵 دالة تنزيل وإرسال أغنية مختارة (تستخدم بعد ما المستخدم يختار رقم من نتائج البحث) ====
// ==== 📥 دالة تحمّل صورة من رابط وترجعها كـ Buffer ====
function downloadImageBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

// ==== 🎬 دالة تجمع كذا صورة مصغّرة بصف أفقي واحد (شكل فيلم ستريب) وترجع صورة نهائية وحدة (Buffer) ====
async function buildThumbnailFilmstrip(thumbnailUrls) {
  const Jimp = require('jimp');
  const panelWidth = 300;
  const panelHeight = 170;
  const gap = 6;

  const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
  const images = [];

  for (let i = 0; i < thumbnailUrls.length; i++) {
    const url = thumbnailUrls[i];
    if (!url) continue;
    try {
      const buffer = await downloadImageBuffer(url);
      const img = await Jimp.read(buffer);
      img.cover(panelWidth, panelHeight); // نقص الصورة لتصير كلهم نفس المقاس بالضبط
      img.print(font, 8, 6, `${i + 1}`); // نطبع رقم النتيجة بزاوية كل صورة
      images.push(img);
    } catch (e) {
      console.log('⚠️ ما قدرت أحمل صورة مصغّرة:', e.message);
    }
  }

  if (images.length === 0) return null;

  const totalWidth = images.length * panelWidth + (images.length - 1) * gap;
  const strip = new Jimp(totalWidth, panelHeight, '#000000');

  images.forEach((img, i) => {
    strip.composite(img, i * (panelWidth + gap), 0);
  });

  return strip.getBufferAsync(Jimp.MIME_JPEG);
}

// ==== 📥 دالة تجيب صورة بروفايل شخص من واتساب كـ Buffer (بترجع null لو ما عنده صورة) ====
async function fetchProfilePicBuffer(sock, jid) {
  try {
    const url = await sock.profilePictureUrl(jid, 'image');
    return await downloadImageBuffer(url);
  } catch (e) {
    return null;
  }
}

// ==== 🚔 دالة تبني "بطاقة سجن" — صورة بروفايل الشخص كاملة خلف قضبان حديد داخل إطار دائري غامق (متل مشهد سينمائي حقيقي) ====
async function buildJailCard(profilePicBuffer) {
  const Jimp = require('jimp');
  const SIZE = 800; // مقاس مربع الصورة النهائية (خلفية سوداء + دائرة بالنص)

  // ---- الصورة الأساسية: صورة الشخص تغطي كامل المربع (مش دائرة صغيرة، متل المرجع) ----
  let scene;
  try {
    scene = await Jimp.read(profilePicBuffer);
  } catch (e) {
    scene = new Jimp(SIZE, SIZE, '#3a3a3a');
  }
  scene.cover(SIZE, SIZE);

  // ---- تعتيم وتغميق الصورة عشان تصير بجو "زنزانة" داكن بدل ما تبين صورة عادية ----
  scene.greyscale();
  scene.brightness(-0.45);
  scene.contrast(0.15);

  // نطبع لون أزرق-رمادي خفيف فوق الصورة (تلوين بارد يعطي إحساس السجن)
  const tint = new Jimp(SIZE, SIZE, 0x1a2230aa);
  scene.composite(tint, 0, 0, { mode: Jimp.BLEND_MULTIPLY, opacitySource: 0.5 });

  // ---- فينييت (تعتيم تدريجي بالأطراف حوالين المنتصف) ----
  const cx = SIZE / 2, cy = SIZE / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  scene.scan(0, 0, SIZE, SIZE, function (x, y, idx) {
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxDist;
    const factor = 1 - Math.min(0.75, Math.max(0, (dist - 0.25) * 0.9));
    this.bitmap.data[idx + 0] *= factor;
    this.bitmap.data[idx + 1] *= factor;
    this.bitmap.data[idx + 2] *= factor;
  });

  // ---- قضبان حديد رأسية سميكة فوق الصورة كاملة (تأثير زنزانة حقيقي) ----
  const barWidth = 26;
  const gapWidth = 90;
  const shadowColor = 0x00000099;
  const metalColor = 0x2b2b2bee;
  const highlightColor = 0x6a6a6a99;
  for (let x = -barWidth; x < SIZE + barWidth; x += barWidth + gapWidth) {
    // ظل خفيف جنب كل قضيب (عمق)
    const shadow = new Jimp(barWidth + 10, SIZE, shadowColor);
    scene.composite(shadow, x - 5, 0);
    // جسم القضيب المعدني
    const bar = new Jimp(barWidth, SIZE, metalColor);
    scene.composite(bar, x, 0);
    // خط لمعان رفيع بالنص عشان يبين معدني/مجسم
    const highlightW = Math.max(3, Math.floor(barWidth * 0.22));
    const highlight = new Jimp(highlightW, SIZE, highlightColor);
    scene.composite(highlight, x + Math.floor((barWidth - highlightW) / 2), 0);
  }

  // ---- نقص الصورة لدائرة، وحطها بنص خلفية سوداء مربعة (تأثير "نافذة دائرية على الزنزانة") ----
  scene.circle();
  const finalCanvas = new Jimp(SIZE, SIZE, '#000000');
  finalCanvas.composite(scene, 0, 0);

  return finalCanvas.getBufferAsync(Jimp.MIME_JPEG);
}

// ==== 🤖 دالة تتحقق هل البوت نفسه أدمن بالقروب — بنفس منطق مقاومة مشكلة @lid يلي فوق ====
async function isBotAdminInGroup(sock, groupId) {
  try {
    const groupMeta = await sock.groupMetadata(groupId);
    // رقم البوت الحقيقي، من أكتر من مصدر ممكن (id أو lid)، حتى لو واتساب بيبعت صيغة مختلفة
    const botNumberFromId = sock.user?.id ? resolveOwnerNumber(sock.user.id.split(':')[0]) : null;
    const botNumberFromLid = sock.user?.lid ? resolveOwnerNumber(sock.user.lid.split(':')[0]) : null;

    const participant = groupMeta.participants.find((p) => {
      const pNumberFromPhoneField = p.phoneNumber ? p.phoneNumber.split('@')[0] : null;
      const pNumberResolved = resolveOwnerNumber(p.id);
      return (
        pNumberFromPhoneField === botNumberFromId ||
        pNumberFromPhoneField === botNumberFromLid ||
        pNumberResolved === botNumberFromId ||
        pNumberResolved === botNumberFromLid ||
        p.id === sock.user?.id ||
        p.lid === sock.user?.lid
      );
    });
    return participant?.admin === 'admin' || participant?.admin === 'superadmin';
  } catch (e) {
    console.log('⚠️ خطأ بفحص صلاحيات البوت بالقروب:', e.message);
    return null; // null = ما قدرنا نتأكد (مش false)، عشان ما نمنع التنفيذ بالخطأ
  }
}

async function downloadAndSendSong(sock, from, info) {
  const title = info.title || 'أغنية';
  const shortTitle = truncateTitle(title);
  const channel = info.channel || info.uploader || 'غير معروف';
  const durationSec = info.duration || 0;
  const minutes = Math.floor(durationSec / 60);
  const seconds = Math.floor(durationSec % 60);
  const durationText = `${minutes}:${String(seconds).padStart(2, '0')}`;
  const sizeApprox = info.filesize_approx || info.filesize;
  const sizeText = sizeApprox ? `${(sizeApprox / (1024 * 1024)).toFixed(2)} MB` : 'غير معروف';
  const url = info.webpage_url || `https://youtu.be/${info.id}`;
  const thumbnail = info.thumbnail;

  // ==== 🛡️ حماية: نرفض تنزيل فيديوهات طويلة جداً (أكتر من 20 دقيقة) حتى ما يعلق البوت أو يفشل التنزيل ====
  if (durationSec > SONG_MAX_DURATION_SEC) {
    await sock.sendMessage(from, {
      text: `⚠️ *${shortTitle}* طويلة كتير (${durationText})، الحد الأقصى ${SONG_MAX_DURATION_SEC / 60} دقيقة. جرب أغنية أقصر.`,
    });
    return;
  }

  // ==== بطاقة معلومات أفقية بسطر واحد (عنوان مختصر لتفادي اللف عالموبايل) ====
  const caption =
    `🎵 *${shortTitle}* │ 📡 ${channel} │ ⏱ ${durationText} │ 💽 ${sizeText}\n🔗 ${url}\n\n⏳ جاري التنزيل...`;

  if (thumbnail) {
    await sock.sendMessage(from, { image: { url: thumbnail }, caption });
  } else {
    await sock.sendMessage(from, { text: caption });
  }

  const safeName = `song_${Date.now()}`;
  const outputTemplate = `/data/data/com.termux/files/home/mybot/${safeName}.%(ext)s`;

  // ==== 🎯 محاولة أولى: تنزيل + تحويل لـ mp3 مباشرة (الأفضل، أنسب صيغة لواتساب) ====
  try {
    await execFilePromise(
      'yt-dlp',
      ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '--no-playlist', '-o', outputTemplate, url],
      { timeout: 120000, maxBuffer: 20 * 1024 * 1024 }
    );
  } catch (e1) {
    console.log('⚠️ فشلت محاولة تنزيل mp3، جاري تجربة الصيغة الأصلية:', e1.stderr || e1.message);

    // ==== 🧹 نمسح أي ملفات ناقصة (.part/.ytdl) خلّفتها المحاولة الأولى، حتى ما تتعارض مع المحاولة الثانية ====
    try {
      for (const f of fs.readdirSync('/data/data/com.termux/files/home/mybot')) {
        if (f.startsWith(safeName + '.')) {
          try { fs.unlinkSync(`/data/data/com.termux/files/home/mybot/${f}`); } catch (e) {}
        }
      }
    } catch (e) {}

    // ==== 🔄 محاولة ثانية (احتياطية): تنزيل الصوت بصيغته الأصلية بدون تحويل mp3 ====
    // (لو المحاولة الأولى فشلت بسبب مشكلة بتحويل ffmpeg، هاي بتنجح غالباً لأنها ما بتحتاج تحويل)
    try {
      await execFilePromise(
        'yt-dlp',
        ['-f', 'bestaudio/best', '--no-playlist', '-o', outputTemplate, url],
        { timeout: 120000, maxBuffer: 20 * 1024 * 1024 }
      );
    } catch (e2) {
      console.log('❌ فشلت المحاولتين بتنزيل الأغنية:', e2.stderr || e2.message);
      await sock.sendMessage(from, {
        text: '❌ صار خطأ أثناء التنزيل (ممكن الفيديو مقيّد بمنطقة معينة أو محذوف). جرب أغنية تانية أو تأكد إنه yt-dlp محدّث (yt-dlp -U).',
      });
      return;
    }
  }

  // ==== 🔍 نلاقي الملف الفعلي يلي انزل (الامتداد بيختلف حسب المحاولة يلي نجحت: mp3 أو m4a أو webm...) ====
  const dir = '/data/data/com.termux/files/home/mybot';
  const matchedFile = fs
    .readdirSync(dir)
    .find((f) => f.startsWith(safeName + '.') && !f.endsWith('.part') && !f.endsWith('.ytdl'));

  if (!matchedFile) {
    await sock.sendMessage(from, { text: '❌ ما قدرت ألاقي أو أنزل الأغنية.' });
    return;
  }

  const finalPath = `${dir}/${matchedFile}`;
  const ext = matchedFile.split('.').pop().toLowerCase();
  const mimeByExt = { mp3: 'audio/mpeg', m4a: 'audio/mp4', webm: 'audio/webm', opus: 'audio/ogg', ogg: 'audio/ogg' };

  // ==== 🛡️ حماية إضافية: نتأكد حجم الملف النهائي مناسب لإرسال واتساب قبل ما نحاول نبعته ====
  const fileSizeMB = fs.statSync(finalPath).size / (1024 * 1024);
  if (fileSizeMB > 45) {
    fs.unlinkSync(finalPath);
    await sock.sendMessage(from, { text: `❌ حجم الملف كبير كتير (${fileSizeMB.toFixed(1)} MB)، ما بينبعت عبر واتساب.` });
    return;
  }

  await sock.sendMessage(from, {
    audio: fs.readFileSync(finalPath),
    mimetype: mimeByExt[ext] || 'audio/mp4',
    fileName: `${title}.${ext}`,
  });

  fs.unlinkSync(finalPath);
}

// ==== 💎 دالة بناء بطاقة فخمة مزخرفة (تستخدم بنتائج وتقارير الأوامر — أرقى شوي من صندوق المساعدة العادي) ====
function buildFancyCard(emoji, title, bodyText, footerText = null) {
  let out =
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `   ${emoji} ✦ *${title}* ✦ ${emoji}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${bodyText}`;
  if (footerText) {
    out += `\n\n┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n${footerText}`;
  }
  return out;
}

// ==== 🎨 دالة بناء صندوق قسم بتصميم عصري وملوّن (تستخدم بقائمة .مساعدة، وممكن تستخدمها بأي قسم جديد تضيفه) ====
function buildHelpSectionBox(emoji, title, body) {
  return (
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `   ${emoji}  『 *${title}* 』  ${emoji}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${body}\n\n` +
    `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n` +
    `🔙 اكتب *.مساعدة* للرجوع للقائمة الرئيسية`
  );
}

// ==== 📋 يبني ويبعت قائمة تفاعلية (أزرار) لاختيار قسم من قائمة المساعدة — تستخدم من .مساعدة و.القائمة معاً ====
async function sendSectionPicker(sock, from) {
  const listSections = [
    {
      title: 'الأقسام',
      rows: [
        { title: '🌟 عام', id: '.مساعدة عام', description: `${BOT_PROFILE_NAME} | أوامر عامة` },
        { title: '🎮 الألعاب', id: '.مساعدة العاب', description: `${BOT_PROFILE_NAME} | كل الألعاب` },
        { title: '⚔️ قتال ومبارزات', id: '.مساعدة قتال', description: `${BOT_PROFILE_NAME} | مبارزات وحروب` },
        { title: '🏅 نقاط وجوائز', id: '.مساعدة نقاط', description: `${BOT_PROFILE_NAME} | نقاط ورتب` },
        { title: '💼 وظائف واستثمار', id: '.مساعدة اقتصاد', description: `${BOT_PROFILE_NAME} | اقتصاد` },
        { title: '💍 زواج وعلاقات', id: '.مساعدة اجتماعي', description: `${BOT_PROFILE_NAME} | اجتماعي` },
        { title: '🛒 متجر النقاط', id: '.مساعدة متجر', description: `${BOT_PROFILE_NAME} | تسوق بنقاطك` },
        { title: '🎁 مرح وأدوات', id: '.مساعدة مرح', description: `${BOT_PROFILE_NAME} | ترفيه` },
        { title: '🕌 دين', id: '.مساعدة دين', description: `${BOT_PROFILE_NAME} | صلاة وأذكار` },
        { title: '👮 إدارة القروب', id: '.مساعدة ادارة', description: `${BOT_PROFILE_NAME} | أوامر الأدمن` },
        { title: '🛡️ حماية القروب', id: '.مساعدة حماية', description: `${BOT_PROFILE_NAME} | أوامر الأدمن` },
        { title: '🔌 مالك البوت', id: '.مساعدة مالك', description: `${BOT_PROFILE_NAME} | تحكم كامل` },
      ],
    },
  ];

  console.log('📋 عم أحاول أبعت القائمة التفاعلية...');
  try {
    await sendListMessage(sock, from, {
      text: `🌈「 ⚡👑 *${BOT_PROFILE_NAME}* 👑⚡ 」🌈\n\n✨ اختر القسم من الزر تحت 👇\n\n⚠️ لو ما ظهر زر عندك، اكتب *.مساعدة* بدلها (نسخة نصية موثوقة 100%)\n\n🔥 أكتر من 100 أمر أسطوري بانتظارك 🔥`,
      footer: `${BOT_NAME} 🌌 أقوى بوت واتساب`,
      title: '⚡ اختر القسم ⚡',
      buttonText: '🔮 تحديد',
      sections: listSections,
      contextInfo: await getChannelContextInfo(sock),
    });
    console.log('✅ تم إرسال القائمة التفاعلية بنجاح.');
    return true;
  } catch (listErr) {
    console.log('❌ فشل إرسال القائمة التفاعلية:', listErr.message);
    console.log(listErr.stack);
    return false;
  }
}

// ==== 📋 دالة عامة لإرسال قائمة تفاعلية (List Message) — بواسطة @whiskeysockets/baileys ====
// هاد الفورك فيه دعم أصلي كامل (binary node wrappers) لـ interactiveButtons (single_select)
async function sendListMessage(sock, jid, { text, footer, title, buttonText, sections, quoted, contextInfo } = {}) {
  const interactiveButtons = [
    {
      name: 'single_select',
      buttonParamsJson: JSON.stringify({
        title: buttonText || 'اضغط هنا',
        sections: sections || [],
      }),
    },
  ];

  await sock.sendMessage(
    jid,
    {
      text: text || '',
      title: title || '',
      footer: footer || '',
      interactiveButtons,
      contextInfo: contextInfo || undefined,
    },
    { quoted: quoted || null }
  );
}

// ==== 🔘 دالة إرسال أزرار تفاعلية ظاهرة مباشرة (بدون فتح قائمة) — كل عنصر بمصفوفة buttons يصير زر لحاله
// نوع الزر: quick_reply (يبعت أمر نصي عند الضغط، زي "قائمة رافن") أو cta_url (يفتح رابط، زي "المطور"/"قناة البوت") ====
async function sendQuickButtons(sock, jid, { text, footer, buttons, quoted, contextInfo } = {}) {
  const interactiveButtons = (buttons || []).map((b) => {
    if (b.url) {
      return {
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({ display_text: b.text, url: b.url, merchant_url: b.url }),
      };
    }
    return {
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({ display_text: b.text, id: b.id || b.text }),
    };
  });

  await sock.sendMessage(
    jid,
    {
      text: text || '',
      footer: footer || '',
      interactiveButtons,
      contextInfo: contextInfo || undefined,
    },
    { quoted: quoted || null }
  );
}

// ==== 📢 يجهّز contextInfo يلي بيخلي زر "عرض القناة" الأخضر يظهر تحت الرسالة (لو نجحت جلب JID القناة مرة وحدة وخزناه بالذاكرة).
// لو فشلت المحاولة (نسخة مكتبة قديمة أو مشكلة شبكة)، بترجع undefined وما تأثر عالرسالة إطلاقاً ====
let cachedChannelJid = null;
let lastChannelJidFetchTry = 0;
const CHANNEL_JID_RETRY_MS = 60 * 1000; // لو فشلت المحاولة، جرب تاني بعد دقيقة (مش تتحفظ كفشل دائم)

async function getChannelContextInfo(sock) {
  if (!cachedChannelJid) {
    const now = Date.now();
    if (now - lastChannelJidFetchTry > CHANNEL_JID_RETRY_MS) {
      lastChannelJidFetchTry = now;
      try {
        if (typeof sock.newsletterMetadata !== 'function') {
          console.log('⚠️ زر القناة: مكتبة Baileys الحالية ما فيها newsletterMetadata — لازم تحدّث المكتبة (npm i @whiskeysockets/baileys@latest).');
        } else {
          const meta = await sock.newsletterMetadata('invite', CHANNEL_INVITE_CODE);
          if (meta && meta.id) {
            cachedChannelJid = meta.id;
            console.log('✅ زر القناة: تم جلب JID القناة بنجاح ->', meta.id);
          } else {
            console.log('⚠️ زر القناة: newsletterMetadata رجعت بدون id، تحقق من CHANNEL_INVITE_CODE.');
          }
        }
      } catch (e) {
        console.log('⚠️ ما قدرت أجيب JID القناة لتفعيل زر "عرض القناة" (رح يعاود المحاولة تلقائياً):', e.message);
      }
    }
  }
  if (!cachedChannelJid) return undefined;
  return {
    forwardingScore: 1,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
      newsletterJid: cachedChannelJid,
      newsletterName: CHANNEL_NAME_FALLBACK,
      serverMessageId: 1,
    },
  };
}



// ==== ⛔ عداد أخطاء الاتصال 403 المتتالية (خارج الدالة حتى يضل قيمته محفوظ بين كل محاولة إعادة اتصال) ====
let consecutive403Count = 0;
const MAX_403_RETRIES = 5;

async function startBotInstance(authFolder = 'auth_info', presetPhoneNumber = null, onPairingCode = null) {
  try {
    fs.mkdirSync(authFolder, { recursive: true });
  } catch (e) {
    // المجلد موجود أصلاً أو صار خطأ بسيط، منكمل عادي
  }
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  // ==== 🔄 نجيب أحدث نسخة من واتساب ويب — تجنّب خطأ 428 (Precondition Required) اللي يصير
  // لما نتصل بنسخة قديمة وواتساب يرفض الاتصال فوراً ====
  let waVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    waVersion = version;
    console.log('📌 نسخة واتساب ويب المستخدمة:', waVersion.join('.'));
  } catch (e) {
    console.log('⚠️ ما قدرت أجيب أحدث نسخة، بنكمل بالنسخة الافتراضية:', e.message);
  }

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '120.0.0.0'],
    defaultQueryTimeoutMs: undefined,
    ...(waVersion ? { version: waVersion } : {}),
  });
  globalSockRef = sock; // ==== 🌍 مرجع عام للسوكيت، يستخدم لتنبيه المالك بالواتساب عند صار خطأ غير متوقع بره دالة البوت ====


  if (!sock.authState.creds.registered) {
    // ==== 📱 طريقة الدخول: كود اقتران (Pairing Code) أو QR كود
    // اكتب رقم هاتفك للحصول على كود اقتران، أو اترك الحقل فاضي واضغط Enter عشان يطلع QR كود ====
    let phoneNumber = presetPhoneNumber || process.env.PHONE_NUMBER;
    if (!phoneNumber) {
      try {
        phoneNumber = await question(
          'أدخل رقم هاتفك مع كود الدولة بدون + أو 00 للحصول على كود اقتران (مثال: 9665xxxxxxxx)\nأو اضغط Enter فاضي عشان يطلعلك QR كود تمسحه: '
        );
      } catch (e) {
        console.log('❌ ما قدرت أخذ الرقم بشكل تفاعلي. ضيف متغير بيئة اسمه PHONE_NUMBER فيه رقم الهاتف وأعد التشغيل.');
        return;
      }
    }

    if (!phoneNumber || !phoneNumber.trim()) {
      // ==== 📷 وضع QR كود: بديل لكود الاقتران، يفيد لو مسار كود الاقتران فيه مشكلة بالمكتبة ====
      console.log('📷 رح يطلعلك QR كود بالأسفل، امسحه من واتساب > الأجهزة المرتبطة > ربط جهاز.');
      try {
        const qrcode = require('qrcode-terminal');
        sock.ev.on('connection.update', (u) => {
          if (u.qr) qrcode.generate(u.qr, { small: true });
        });
      } catch (e) {
        console.log('⚠️ مكتبة qrcode-terminal غير مثبتة. ثبتها بـ: npm install qrcode-terminal');
        console.log('   أو استخدم كود الاقتران بدالها (أدخل رقم الهاتف).');
      }
    } else {
      console.log(`📱 استخدام رقم الهاتف: ${phoneNumber}`);
      // ننتظر شوي عشان الاتصال (handshake) يخلص كامل قبل ما نطلب الكود، وإلا بيصير خطأ 428
      // (الوقت أطول من المعتاد عشان يتحمل شبكات الجوال البطيئة/غير المستقرة)
      await new Promise((resolve) => setTimeout(resolve, 6000));
      try {
        const code = await sock.requestPairingCode(phoneNumber.trim());
        console.log(`\n🔑 كود الاقتران: ${code}\n`);
        console.log('روح لواتساب > الأجهزة المرتبطة > ربط جهاز > ربط برقم الهاتف بدل QR، وأدخل الكود فوق.');
        if (onPairingCode) {
          try {
            await onPairingCode(code);
          } catch (e) {
            console.log('⚠️ ما قدرت أبعت كود الاقتران للطالب:', e.message);
          }
        }
      } catch (e) {
        console.log('❌ صار خطأ أثناء طلب كود الاقتران:', e.message);
        console.log('📋 تفاصيل إضافية للتشخيص:');
        console.log('   - statusCode:', e?.output?.statusCode || e?.data?.statusCode || 'غير معروف');
        console.log('   - السبب الكامل:', JSON.stringify(e?.data || e?.output || {}, null, 2));
        if (e?.stack) console.log('   - Stack:', e.stack.split('\n').slice(0, 3).join('\n'));
        console.log('🔁 جرب تشغيل البوت من جديد بعد شوي.');
        if (presetPhoneNumber) activeInstalls.delete(presetPhoneNumber);
      }
    }
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'connecting') {
      console.log('🔄 جاري الاتصال بسيرفرات واتساب...');
    } else if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('الاتصال انقطع، إعادة محاولة:', shouldReconnect, '| السبب:', lastDisconnect?.error?.message || 'غير معروف', '| كود:', statusCode);

      if (!shouldReconnect) {
        console.log('🚪 الجلسة اتسجل خروجها من واتساب (Logged Out). لازم تمسح مجلد', authFolder, 'وتربط الرقم من جديد.');
        return;
      }

      // ==== ⛔ كود 403 = واتساب رافض الاتصال بالكامل (مش مشكلة شبكة عابرة). إعادة المحاولة فوراً وبلا توقف
      // بتقصف سيرفراتهم وممكن تخلي الحظر أسوأ (دائم)، فمنعدّ المحاولات المتتالية ومنوقف تلقائياً بعد كام محاولة ====
      if (statusCode === 403) {
        consecutive403Count += 1;
        console.log(`⛔ خطأ 403 (رفض اتصال من واتساب) — محاولة رقم ${consecutive403Count} من ${MAX_403_RETRIES}.`);

        if (consecutive403Count >= MAX_403_RETRIES) {
          console.log(
            '\n🛑 توقف البوت عن المحاولة التلقائية بعد عدة أخطاء 403 متتالية.\n' +
            '   هاد الخطأ يعني واتساب رافض الاتصال بالكامل، غالباً لسبب من هاد:\n' +
            `   1) الجلسة/الرقم صار محظور أو مقطوع من واتساب.\n` +
            `   2) IP السيرفر (${authFolder}) متبلّغ عنه من واتساب — جرب VPN أو سيرفر/شبكة تانية.\n` +
            `   3) ملفات الجلسة (${authFolder}) تلفت.\n\n` +
            `   🔧 الحل: امسح مجلد "${authFolder}" بالكامل وشغّل البوت من جديد لتربط الرقم من الصفر.\n` +
            `   لو تكرر معك نفس الخطأ برقم جديد كمان، غالباً المشكلة بالـIP/السيرفر مش بالرقم.\n`
          );
          return; // ==== منوقف هون، ما منعيد المحاولة تلقائياً بعد كل هالفشل ====
        }

        // ==== تأخير متصاعد (backoff) قبل كل محاولة تانية بعد 403، حتى ما نقصف السيرفرات ====
        const backoffMs = Math.min(60000, 5000 * consecutive403Count);
        console.log(`⏳ منستنى ${Math.round(backoffMs / 1000)} ثانية قبل المحاولة الجاية...`);
        setTimeout(() => startBotInstance(authFolder, presetPhoneNumber, onPairingCode), backoffMs);
        return;
      }

      // ==== أي خطأ اتصال تاني (مش 403 ومش logged out): إعادة محاولة عادية بعد تأخير قصير بدل الفوري ====
      setTimeout(() => startBotInstance(authFolder, presetPhoneNumber, onPairingCode), 3000);
    } else if (connection === 'open') {
      consecutive403Count = 0; // ==== نجح الاتصال، منصفّر عداد أخطاء الـ403 ====
      console.log('✅ البوت متصل بنجاح!');
      console.log('🔖🔖🔖 نسخة الملف الحالية: LIST-MENU-V4-ITSUKICHAN (اذا ما شفت هالسطر يعني الملف القديم لسا شغال) 🔖🔖🔖');

      // ==== 🏷️ تحديث اسم بروفايل واتساب تلقائياً ليصير اسم البوت الرسمي ====
      try {
        await sock.updateProfileName(BOT_PROFILE_NAME);
      } catch (e) {
        console.log('⚠️ ما قدرت أحدث اسم البروفايل:', e.message);
      }

      if (presetPhoneNumber) {
        const prevEntry = activeInstalls.get(presetPhoneNumber) || {};
        activeInstalls.set(presetPhoneNumber, { ...prevEntry, status: 'connected', connectedAt: Date.now() });
      }

      // ==== 🧹 تنظيف الملفات المؤقتة عند بدء التشغيل ====
      const startupCleanup = cleanupTempFiles();
      if (startupCleanup.count > 0) {
        console.log(`🧹 تم حذف ${startupCleanup.count} ملف مؤقت (${startupCleanup.totalMB} MB) عند بدء التشغيل.`);
      }

      // ==== 🧹 تنظيف تلقائي دوري كل ساعة ====
      if (!cleanupSchedulerStarted) {
        cleanupSchedulerStarted = true;
        setInterval(() => {
          const result = cleanupTempFiles();
          if (result.count > 0) {
            console.log(`🧹 تنظيف دوري: تم حذف ${result.count} ملف (${result.totalMB} MB).`);
          }
        }, 60 * 60 * 1000); // كل ساعة
      }

      // ==== 🧹 تنظيف دوري للذاكرة المؤقتة (Trackers) — يمنع تراكم البيانات وتسرب الرام مع طول التشغيل ====
      if (!memoryCleanupSchedulerStarted) {
        memoryCleanupSchedulerStarted = true;
        setInterval(() => {
          try {
            cleanupMemoryTrackers();
          } catch (e) {
            console.log('⚠️ خطأ بتنظيف الذاكرة المؤقتة:', e.message);
          }
        }, 15 * 60 * 1000); // كل 15 دقيقة
      }

      // ==== 🩺 تقرير صحة يومي تلقائي لصاحب البوت (اتصال/حفظ/رام/عدد القروبات) ====
      if (!dailyHealthSchedulerStarted) {
        dailyHealthSchedulerStarted = true;
        setInterval(() => {
          sendDailyHealthReport(sock).catch((e) => console.log('⚠️ خطأ بتقرير الصحة اليومي:', e.message));
        }, 24 * 60 * 60 * 1000); // كل 24 ساعة
      }

      // ==== ⏰ إعادة جدولة كل التذكيرات المحفوظة (اللي كانت موجودة قبل إعادة تشغيل البوت) ====
      scheduleAllSavedReminders(sock);

      // ==== 💾 نسخ احتياطي تلقائي يومي — يبعت لصاحب البوت الأول بالخاص (لو الميزة مفعّلة) ====
      if (!backupSchedulerStarted) {
        backupSchedulerStarted = true;
        setInterval(async () => {
          if (!botSettings.autoBackup) return;
          try {
            const filePath = createBackupBundle();
            const ownerJid = ADMINS[0];
            await sock.sendMessage(ownerJid, {
              document: fs.readFileSync(filePath),
              fileName: filePath.split('/').pop(),
              mimetype: 'application/json',
              caption: '💾 ✦ *نسخة احتياطية تلقائية يومية* ✦',
            });
            console.log('💾 تم إرسال النسخة الاحتياطية التلقائية.');
          } catch (e) {
            console.log('⚠️ خطأ بالنسخ الاحتياطي التلقائي:', e.message);
          }
        }, 24 * 60 * 60 * 1000); // كل 24 ساعة
      }

      // ==== 🏆 تشغيل مجدول لوحة الصدارة الأسبوعية — يفحص كل ساعة إذا لازم يصفّر الأسبوع ويعلن الأبطال ====
      if (!weeklySchedulerStarted) {
        weeklySchedulerStarted = true;
        checkWeeklyReset(null).catch((e) => console.log('⚠️ خطأ بتثبيت بداية الأسبوع:', e.message)); // أول تشغيل: يثبّت بداية الأسبوع الحالي بدون ما يعلن أي شي (ما في أسبوع سابق أصلاً)
        setInterval(() => {
          checkWeeklyReset(sock).catch((e) => console.log('⚠️ خطأ بمجدول اللوحة الأسبوعية:', e.message));
        }, 60 * 60 * 1000); // كل ساعة
      }

      // ==== تشغيل مجدول تذكير الصلاة مرة وحدة بس ====
      if (!prayerSchedulerStarted) {
        prayerSchedulerStarted = true;
        setInterval(async () => {
          try {
            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const currentTime = `${hh}:${mm}`;
            const todayStr = now.toDateString();

            for (const groupId in prayerTimes) {
              for (const prayerName in prayerTimes[groupId]) {
                if (prayerTimes[groupId][prayerName] === currentTime) {
                  const key = `${groupId}_${prayerName}`;
                  if (lastPrayerTrigger[key] !== todayStr) {
                    lastPrayerTrigger[key] = todayStr;
                    try {
                      const groupMeta = await sock.groupMetadata(groupId);
                      const allParticipants = groupMeta.participants.map((p) => p.id);
                      await sock.sendMessage(groupId, {
                        text: `🕌 ✦ *حان الآن وقت صلاة ${prayerName}* ✦\nاللهم تقبل منا ومنكم 🤲`,
                        mentions: allParticipants,
                      });
                    } catch (e) {
                      console.log('⚠️ ما قدرت أبعت تذكير الصلاة:', e.message);
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.log('⚠️ خطأ بمجدول الصلاة:', e.message);
          }
        }, 30000); // فحص كل 30 ثانية
      }

      // ==== 🌙 تشغيل مجدول الصلاة على النبي كل 30 دقيقة ====
      if (!salawatSchedulerStarted) {
        salawatSchedulerStarted = true;
        setInterval(async () => {
          for (const groupId of salawatGroups) {
            try {
              const phrase = salawatPhrases[Math.floor(Math.random() * salawatPhrases.length)];
              await sock.sendMessage(groupId, {
                text: `╭──✦ 🌙 *تذكير* 🌙 ✦──╮\n\n${phrase}\n\n╰──────────╯`,
              });
            } catch (e) {
              console.log('⚠️ ما قدرت أبعت تذكير الصلاة على النبي:', e.message);
            }
          }
        }, 30 * 60 * 1000); // كل 30 دقيقة
      }

      // ==== 🔨 تشغيل مجدول فحص المزادات المنتهية (يحسم أي مزاد خلص وقته تلقائياً) ====
      if (!auctionSchedulerStarted) {
        auctionSchedulerStarted = true;
        setInterval(async () => {
          try {
            const now = Date.now();
            for (const groupId of Object.keys(auctions)) {
              if (auctions[groupId] && auctions[groupId].endsAt <= now) {
                await resolveAuction(sock, groupId);
              }
            }
          } catch (e) {
            console.log('⚠️ خطأ بمجدول المزادات:', e.message);
          }
        }, 30000); // فحص كل 30 ثانية
      }

      // ==== 💀 تشغيل مجدول فحص الحروب الجماعية (يبدأ الحرب تلقائياً بعد مهلة الانضمام + شبكة أمان ضد تعليقها) ====
      if (!warSchedulerStarted) {
        warSchedulerStarted = true;
        setInterval(async () => {
          try {
            const now = Date.now();
            for (const groupId of Object.keys(wars)) {
              const war = wars[groupId];
              if (!war) continue;

              // ---- ⏰ تذكير قبل ما تخلص مهلة الانضمام بشوي، حتى يلحقوا ينضموا ----
              if (
                war.phase === 'joining' &&
                !war.reminderSent &&
                war.joinEndsAt - now > 0 &&
                war.joinEndsAt - now <= 15000
              ) {
                war.reminderSent = true;
                const count = Object.keys(war.participants).length;
                await sock.sendMessage(groupId, {
                  text: `⏰ ✦ باقي أقل من 15 ثانية على قفل باب الانضمام! (${count} منضمين لهلق) اكتبوا *.انضم* بسرعة!`,
                });
              }

              // ---- 🚀 تحويل الحرب من مرحلة الانضمام للمرحلة الفعلية بعد ما تخلص المهلة ----
              if (war.phase === 'joining' && now > war.joinEndsAt) {
                const participantCount = Object.keys(war.participants).length;
                if (participantCount < 2) {
                  delete wars[groupId];
                  await sock.sendMessage(groupId, { text: '😅 ما انضم عدد كافي (أقل من شخصين)، اتلغت الحرب.' });
                  continue;
                }
                war.phase = 'active';
                const list = Object.values(war.participants).map((p) => `⚔️ @${p.jid.split('@')[0]}  ${renderHpBar(p.hp, WAR_MAX_HP)}`).join('\n');
                await sock.sendMessage(groupId, {
                  text: `╔═══════════╗\n   🔥 *بدأت الحرب فعلياً!* 🔥\n╚═══════════╝\n\nالمشاركين:\n${list}\n\n⚔️ هجموا! .هجوم @شخص`,
                  mentions: Object.values(war.participants).map((p) => p.jid),
                });
              }

              // ---- 🛡️ شبكة أمان: لو الحرب علقت أكتر من 30 دقيقة، تنتهي تلقائياً وصاحب أعلى حياة يفوز ----
              else if (war.phase === 'active' && now - war.joinEndsAt > 30 * 60 * 1000) {
                delete wars[groupId];
                const alive = Object.values(war.participants).filter((p) => p.hp > 0);
                if (alive.length > 0) {
                  alive.sort((a, b) => b.hp - a.hp);
                  const winner = alive[0];
                  const newTotal = addPoints(winner.jid, 50);
                  await sock.sendMessage(groupId, {
                    text: `⏰ ✦ *انتهى وقت الحرب!* ✦\n🏆 صاحب أعلى حياة فاز: @${winner.jid.split('@')[0]} (+50 نقطة، المجموع: ${newTotal})`,
                    mentions: [winner.jid],
                  });
                } else {
                  await sock.sendMessage(groupId, { text: '⏰ انتهى وقت الحرب بدون ناجين!' });
                }
              }
            }
          } catch (e) {
            console.log('⚠️ خطأ بمجدول الحروب:', e.message);
          }
        }, 30000); // فحص كل 30 ثانية
      }

      // ==== 📿 تشغيل مجدول الأذكار العامة كل 30 دقيقة ====
      if (!azkarSchedulerStarted) {
        azkarSchedulerStarted = true;
        setInterval(async () => {
          for (const groupId of azkarGroups) {
            try {
              const phrase = azkarPhrases[Math.floor(Math.random() * azkarPhrases.length)];
              await sock.sendMessage(groupId, {
                text: `╭──✦ 📿 *ذكر* 📿 ✦──╮\n\n${phrase}\n\n╰──────────╯`,
              });
            } catch (e) {
              console.log('⚠️ ما قدرت أبعت الذكر:', e.message);
            }
          }
        }, 30 * 60 * 1000); // كل 30 دقيقة
      }
    }
  });

  // ==== نظام الترحيب والوداع بالقروبات ====
  // ==== 🚪 إشعار الأدمن تلقائياً لما يوصل طلب انضمام جديد (لو خاصية .وضع_الموافقة مفعّلة بالقروب) ====
  sock.ev.on('group.join-request', async (update) => {
    try {
      const { id: groupId, participant, author } = update;
      const requesterJid = participant || author;
      if (!requesterJid) return;
      const groupMeta = await sock.groupMetadata(groupId);
      const admins = groupMeta.participants.filter((p) => p.admin === 'admin' || p.admin === 'superadmin');
      const requesterNumber = requesterJid.split('@')[0];
      const text =
        `🚪 ✦ *طلب انضمام جديد!* ✦\n\n` +
        `📱 الرقم: ${requesterNumber}\n` +
        `📛 القروب: ${groupMeta.subject}\n\n` +
        `✅ .قبول_عضو ${requesterNumber}\n` +
        `❌ .رفض_عضو ${requesterNumber}`;
      for (const admin of admins) {
        try {
          await sock.sendMessage(admin.id, { text });
        } catch (e) {}
      }
    } catch (e) {
      console.log('⚠️ خطأ بمعالجة طلب انضمام جديد (قد لا تكون هاد الميزة مدعومة بنسخة Baileys الحالية):', e.message);
    }
  });

  sock.ev.on('group-participants.update', async (update) => {
    try {
      const { id: groupId, participants, action } = update;
      const groupMeta = await sock.groupMetadata(groupId);
      const groupName = groupMeta.subject;

      for (const participant of participants) {
        // بعض نسخ Baileys بترجع participant كـ object بدل نص، هاد يتعامل مع الحالتين
        const participantId = typeof participant === 'string' ? participant : participant.id;
        const userName = '@' + participantId.split('@')[0];

        if (action === 'add') {
          const welcomeText = buildFancyCard(
            '🎉',
            'أهلاً وسهلاً',
            `👋 ${userName}\nمرحباً بك في *${groupName}*!\nنورت معنا، اقرا القوانين واستمتع 🌟`
          );

          // ==== نحاول نجيب صورة العضو الجديد، ولو ما عنده صورة نبعت نص بس ====
          let profilePicUrl = null;
          try {
            profilePicUrl = await sock.profilePictureUrl(participantId, 'image');
          } catch (e) {
            // العضو ما عنده صورة شخصية أو خصوصيتها مقفلة
          }

          if (profilePicUrl) {
            await sock.sendMessage(groupId, {
              image: { url: profilePicUrl },
              caption: welcomeText,
              mentions: [participantId],
            });
          } else {
            await sock.sendMessage(groupId, {
              text: welcomeText,
              mentions: [participantId],
            });
          }

          // ==== إرسال أغنية ترحيب ثابتة (لو الملف موجود) ====
          const welcomeSongPath = '/data/data/com.termux/files/home/mybot/welcome.mp3';
          if (fs.existsSync(welcomeSongPath)) {
            try {
              await sock.sendMessage(groupId, {
                audio: fs.readFileSync(welcomeSongPath),
                mimetype: 'audio/mp4',
              });
            } catch (e) {
              console.log('⚠️ ما قدرت أبعت أغنية الترحيب:', e.message);
            }
          }
        } else if (action === 'remove') {
          await sock.sendMessage(groupId, {
            text: buildFancyCard('👋', 'وداعاً', `${userName} غادر القروب.\nإلى اللقاء 🌙`),
            mentions: [participantId],
          });

          // ==== إرسال صوت وداع ثابت (لو الملف موجود) ====
          const goodbyeSongPath = '/data/data/com.termux/files/home/mybot/goodbye.mp3';
          if (fs.existsSync(goodbyeSongPath)) {
            try {
              await sock.sendMessage(groupId, {
                audio: fs.readFileSync(goodbyeSongPath),
                mimetype: 'audio/mp4',
              });
            } catch (e) {
              console.log('⚠️ ما قدرت أبعت صوت الوداع:', e.message);
            }
          }
        }
      }
    } catch (err) {
      console.log('❌ خطأ بنظام الترحيب:', err.message);
    }
  });

  // ==== 🗄 ذاكرة مؤقتة لآخر الرسائل، تستخدم لميزة "تنبيه الرسائل المحذوفة" ====
  const messageCache = {}; // { "chatId_msgId": { text, sender, timestamp } }
  function cacheMessage(chatId, msgId, senderId, msgText) {
    if (!msgText) return;
    messageCache[`${chatId}_${msgId}`] = { text: msgText, sender: senderId, timestamp: Date.now() };
    // تنظيف بسيط: لو الذاكرة كبرت كتير، نمسح الأقدم من ساعة
    const keys = Object.keys(messageCache);
    if (keys.length > 500) {
      const cutoff = Date.now() - 60 * 60 * 1000;
      for (const k of keys) {
        if (messageCache[k].timestamp < cutoff) delete messageCache[k];
      }
    }
  }

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message) return;

      const from = msg.key.remoteJid;
      const isGroup = from.endsWith('@g.us');

      // ==== 🕵️ تنبيه الرسائل المحذوفة: لو حدا حذف رسالته وميزة الحماية مفعّلة، البوت يعيد نشرها ====
      const revokedKey = msg.message.protocolMessage?.type === 0 ? msg.message.protocolMessage.key : null;
      if (revokedKey && isGroup) {
        const settings = protectionSettings[from];
        if (settings && settings.antidelete === true) {
          const cached = messageCache[`${from}_${revokedKey.id}`];
          if (cached) {
            await sock.sendMessage(from, {
              text:
                `🕵️ ✦ *تم حذف رسالة!* ✦\n\n` +
                `👤 من: @${cached.sender.split('@')[0]}\n` +
                `💬 النص: ${cached.text}`,
              mentions: [cached.sender],
            });
          }
        }
        return; // إشعار الحذف مش رسالة عادية، نوقف هون
      }

      if (msg.key.fromMe) return;

      // ==== 🔎 حل مشكلة معرّفات @lid: واتساب أحياناً بيبعت معرّف مخفي بدل رقم الهاتف الحقيقي ====
      // Baileys بيوفر حقل بديل (Alt) فيه رقم الهاتف الحقيقي حتى لو الأساسي كان @lid
      function resolveSenderId() {
        const rawParticipant = isGroup ? msg.key.participant : from;
        const altId = isGroup ? msg.key.participantAlt : msg.key.remoteJidAlt;
        if (rawParticipant && rawParticipant.endsWith('@s.whatsapp.net')) return rawParticipant;
        if (altId && altId.endsWith('@s.whatsapp.net')) return altId;
        return rawParticipant || altId;
      }
      const sender = resolveSenderId();

      // ==== 🐦 رياكشن خاص: كل رسالة من هذا الرقم بيتفاعل معها البوت بإيموجي طائر ====
      const SPECIAL_BIRD_NUMBER = '213778949637';
      if (sender && resolveOwnerNumber(sender) === SPECIAL_BIRD_NUMBER) {
        try {
          await sock.sendMessage(from, { react: { text: '🐦', key: msg.key } });
        } catch (e) {
          // تجاهل بهدوء لو الرسالة ما بتقبل رياكشن
        }
      }

      // ==== فحص الحظر: تجاهل أي رسالة من رقم محظور ====
      if (banned.includes(sender)) return;

      // ==== 👁️ مراقبة رسائل المشاهدة الواحدة (View Once): تُعاد إرسالها لصاحب البوت بالخاص لو الميزة مفعّلة ====
      // مطفية افتراضياً احتراماً لخصوصية الأعضاء؛ الأدمن يفعّلها بـ .تفعيل_مراقبة_المشاهدة
      if (botSettings.antiViewOnce) {
        try {
          const voMsg =
            msg.message.viewOnceMessageV2?.message ||
            msg.message.viewOnceMessage?.message ||
            (msg.message.imageMessage?.viewOnce ? { imageMessage: msg.message.imageMessage } : null) ||
            (msg.message.videoMessage?.viewOnce ? { videoMessage: msg.message.videoMessage } : null);

          if (voMsg) {
            const mediaType = voMsg.imageMessage ? 'image' : voMsg.videoMessage ? 'video' : null;
            if (mediaType) {
              const mediaMsgContent = voMsg[`${mediaType}Message`];
              const stream = await downloadContentFromMessage(mediaMsgContent, mediaType);
              let buffer = Buffer.from([]);
              for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

              const ownerJid = ADMINS[0];
              const senderNumber = sender ? sender.split('@')[0] : 'غير معروف';
              const caption = `👁️ ✦ *رسالة مشاهدة واحدة* ✦\n\n👤 من: ${senderNumber}\n💬 المحتوى: ${
                mediaMsgContent.caption || '(بدون نص)'
              }`;

              if (mediaType === 'image') {
                await sock.sendMessage(ownerJid, { image: buffer, caption });
              } else {
                await sock.sendMessage(ownerJid, { video: buffer, caption });
              }
            }
          }
        } catch (e) {
          console.log('⚠️ خطأ بمراقبة رسالة المشاهدة الواحدة:', e.message);
        }
      }

      // ==== 📋 استخراج اختيار المستخدم من قائمة تفاعلية حديثة (nativeFlowMessage / single_select) ====
      let nativeFlowSelectedId = null;
      try {
        const nativeFlowJson = msg.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
        if (nativeFlowJson) nativeFlowSelectedId = JSON.parse(nativeFlowJson).id || null;
      } catch (e) {
        // تجاهل لو ما قدرنا نفكها
      }

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        nativeFlowSelectedId ||
        msg.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        msg.message.buttonsResponseMessage?.selectedButtonId ||
        msg.message.templateButtonReplyMessage?.selectedId ||
        '';

      const command = text.trim().split(' ')[0].toLowerCase();
      const args = text.trim().split(' ').slice(1);

      // ==== 🐌 حماية النظام: مهلة صغيرة بين كل أمر والتاني لنفس الشخص (يستثني مالك البوت) ====
      if (command.startsWith('.') && sender && !isBotOwner(sender)) {
        const now = Date.now();
        const lastCmd = lastCommandTime[sender] || 0;
        if (now - lastCmd < COMMAND_COOLDOWN_MS) {
          return; // نتجاهل بهدوء، بدون رسالة، حتى ما نزيد سبام فوق سبام
        }
        lastCommandTime[sender] = now;
      }

      // ==== 🤖 حماية كوتا الذكاء الاصطناعي: حد يومي لأوامر Gemini/Groq الثقيلة (التبريد بين كل سؤال موجود أصلاً بـ checkAiCooldown داخل كل أمر) ====
      if (heavyAiCommands.has(command) && sender && !isBotOwner(sender)) {
        const quota = checkAndTrackAiQuota(sender);
        if (!quota.allowed) {
          await sock.sendMessage(from, {
            text:
              `🚫 وصلت للحد اليومي لأوامر الذكاء الاصطناعي (${quota.limit} استخدام/يوم).\n` +
              `🔄 بترجع تقدر تستخدمها بكرة، أو 💠 اشترك VIP من .المتجر لحد أعلى.\n` +
              `📊 اكتب .كوتتي لتشوف رصيدك المتبقي.`,
          });
          return;
        }
      }

      // ==== 📊 نتابع كل أمر يُستخدم (لتحليل الأوامر الأكثر استخداماً لاحقاً) ====
      trackCommandUsage(command);

      // نخزّن الرسالة بالذاكرة المؤقتة (تستخدم لميزة تنبيه الرسائل المحذوفة)
      if (isGroup && text) cacheMessage(from, msg.key.id, sender, text);

      // ==== 📊 عداد رسائل القروب (لأمر .احصائيات) ====
      if (isGroup) {
        if (!groupStats[from]) groupStats[from] = { messages: 0 };
        groupStats[from].messages++;
        if (groupStats[from].messages % 15 === 0) saveJSON(GROUP_STATS_FILE, groupStats);
      }

      // ==== 🔌 تشغيل/إيقاف البوت (حصراً الرقم المنتهي بـ 54، يشتغل حتى لو البوت متوقف) ====
      const isPowerController = sender && resolveOwnerNumber(sender) === '213778949637';

      if (command === '.تشغيل_البوت') {
        if (!isPowerController) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر حصراً لصاحب صلاحية التشغيل/الإيقاف.*' });
          return;
        }
        botEnabled = true;
        await sock.sendMessage(from, { text: '✅ ✦ *تم تشغيل البوت من جديد* ✦' });
        return;
      } else if (command === '.ايقاف_البوت') {
        if (!isPowerController) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر حصراً لصاحب صلاحية التشغيل/الإيقاف.*' });
          return;
        }
        botEnabled = false;
        await sock.sendMessage(from, {
          text: '🔴 ✦ *تم إيقاف البوت* ✦\n\nما رح يرد على أي رسالة لحد ما تكتب .تشغيل_البوت',
        });
        return;
      }

      // ==== إذا البوت متوقف، تجاهل أي رسالة غير أوامر التشغيل فوق ====
      if (!botEnabled) return;

      // ==== 😀 رياكشن تلقائي بإيموجي حسب الأمر ====
      if (commandReactions[command]) {
        try {
          await sock.sendMessage(from, { react: { text: commandReactions[command], key: msg.key } });
        } catch (e) {
          // بعض الرسائل ما بتقبل رياكشن، تجاهل بهدوء
        }
      }

      // ==== 💬 ردود تلقائية على التحية ====
      if (text && !text.trim().startsWith('.')) {
        const greeting = text.trim();
        if (
          greeting === 'سلام' ||
          greeting === 'سلام عليكم' ||
          greeting === 'السلام عليكم' ||
          greeting === 'السلام عليكم ورحمة الله وبركاته'
        ) {
          await sock.sendMessage(from, { text: 'وعليكم السلام ورحمة الله وبركاته 🌙' });
        } else if (greeting === 'كيفكم' || greeting === 'كيفك' || greeting === 'كيف حالكم' || greeting === 'كيفاش') {
          await sock.sendMessage(from, { text: 'بخير الحمد لله وانت 😊' });
        } else if (greeting === 'دوم') {
          await sock.sendMessage(from, { text: 'علينا وعليك يارب 🤲' });
        }

        // ==== 📚 رد تلقائي من "ذكاء اصطناعي خاص فيك" — بدون أي أمر، لو الرسالة قريبة كتير من سؤال معلّم ====
        else if (customKnowledge.length > 0) {
          const autoMatch = findKnowledgeAnswer(greeting, 0.6); // نسبة تشابه أعلى من أمر .بوتي حتى ما يرد غلط عالعفو
          if (autoMatch) {
            await sock.sendMessage(from, { text: `🤖 ${autoMatch.a}` });
          }
        }
      }

      // ==== 🔇 فحص الكتم المؤقت: إذا الشخص مكتوم، نحذف رسالته بهدوء بدون إنذار (يشتغل حتى على الأدمن العادي المكتوم مؤقتاً) ====
      if (isGroup) {
        const groupMutes = mutedUsers[from];
        const muteExpiry = groupMutes && groupMutes[pointsKey(sender)];
        if (muteExpiry) {
          if (Date.now() < muteExpiry) {
            try {
              await sock.sendMessage(from, { delete: msg.key });
            } catch (e) {}
            return;
          } else {
            delete groupMutes[pointsKey(sender)];
            saveMutes();
          }
        }
      }

      // ==== 🐢 فحص الوضع البطيء: يمنع غير الأدمن من الكتابة أسرع من المهلة المحددة ====
      if (isGroup && text && !text.startsWith('.') && slowMode[from] > 0 && !(await isAdminOrOwner(sock, from, sender))) {
        const key = pointsKey(sender);
        if (!lastMessageTime[from]) lastMessageTime[from] = {};
        const last = lastMessageTime[from][key] || 0;
        const waitSeconds = slowMode[from];
        const elapsed = (Date.now() - last) / 1000;
        if (elapsed < waitSeconds) {
          try {
            await sock.sendMessage(from, { delete: msg.key });
          } catch (e) {}
          return;
        }
        lastMessageTime[from][key] = Date.now();
      }

      // ==== 🛡 حماية تلقائية من الروابط والسب والسبام وقفل الوسائط ومنشن الجماعي والرسائل المكررة (بالقروبات، تستثني الأدمن) ====
      if (isGroup && !(await isAdminOrOwner(sock, from, sender))) {
        const settings = protectionSettings[from] || { links: true, words: true };
        const linksEnabled = settings.links !== false;
        const wordsEnabled = settings.words !== false;
        const floodEnabled = settings.flood === true; // مطفية افتراضياً، الأدمن يفعّلها لو حاب
        const mediaLockEnabled = settings.medialock === true; // مطفية افتراضياً
        const mentionGuardEnabled = settings.mentionguard !== false; // منشن جماعي مشبوه — مفعّلة افتراضياً
        const noMentionEnabled = settings.nomention === true; // منع أي منشن نهائياً — مطفية افتراضياً، الأدمن يفعّلها لو حاب
        const repeatGuardEnabled = settings.repeatguard !== false; // رسائل مكررة نفس النص — مفعّلة افتراضياً
        const forwardGuardEnabled = settings.forwardguard !== false; // رسائل متداولة كتير (تشين ميساج) — مفعّلة افتراضياً

        const hasLink = text && linksEnabled && linkPattern.test(text);
        const hasBadWord = text && wordsEnabled && badWords.some((w) => text.includes(w));
        const isMedia = !!(
          msg.message.imageMessage ||
          msg.message.videoMessage ||
          msg.message.stickerMessage ||
          msg.message.documentMessage
        );
        const hasLockedMedia = mediaLockEnabled && isMedia;

        // ---- 🚨 منشن جماعي مشبوه: تاغ أكتر من 5 أشخاص برسالة وحدة (تكتيك مضايقة/ريد شائع) ----
        const mentionedCount = (msg.message.extendedTextMessage?.contextInfo?.mentionedJid || []).length;
        const hasMassMention = mentionGuardEnabled && mentionedCount > 5;

        // ---- 🚫 منع المنشن الكامل: أي منشن (حتى شخص وحيد) لو مفعّلة هاي الميزة بالقروب ----
        const hasAnyMention = noMentionEnabled && mentionedCount >= 1;

        // ---- 🚫 كتابة "@الكل" أو "@all" — محاولة منشن جماعي عن طريق النص مباشرة، ممنوعة على غير الأدمن دايماً ----
        const hasTagAll = !!(text && /@(الكل|all)\b/i.test(text));

        // ---- 🚨 رسالة متداولة كتير (Forwarded كتير) — غالباً رسائل تشين/سبام جاهزة ----
        const forwardScore = msg.message.extendedTextMessage?.contextInfo?.forwardingScore || 0;
        const hasMassForward = forwardGuardEnabled && forwardScore >= 5;

        // ---- كشف السبام: أكتر من 8 رسائل خلال 10 ثواني من نفس الشخص ----
        let hasFlood = false;
        if (floodEnabled && text) {
          if (!floodTracker[from]) floodTracker[from] = {};
          if (!floodTracker[from][sender]) floodTracker[from][sender] = [];
          const now = Date.now();
          floodTracker[from][sender] = floodTracker[from][sender].filter((t) => now - t < 10000);
          floodTracker[from][sender].push(now);
          if (floodTracker[from][sender].length > 8) {
            hasFlood = true;
            floodTracker[from][sender] = []; // نصفّر بعد ما نعاقب عشان ما نكرر العقاب كل رسالة
          }
        }

        // ---- 🚨 نفس الرسالة بالضبط مكررة 3 مرات خلال 20 ثانية (سبام بطيء بيتفادى كاشف السرعة) ----
        let hasRepeat = false;
        if (repeatGuardEnabled && text && text.trim().length >= 3) {
          if (!repeatTracker[from]) repeatTracker[from] = {};
          if (!repeatTracker[from][sender]) repeatTracker[from][sender] = [];
          const now = Date.now();
          repeatTracker[from][sender] = repeatTracker[from][sender].filter((e) => now - e.t < 20000);
          repeatTracker[from][sender].push({ t: now, text: text.trim() });
          const sameCount = repeatTracker[from][sender].filter((e) => e.text === text.trim()).length;
          if (sameCount >= 3) {
            hasRepeat = true;
            repeatTracker[from][sender] = [];
          }
        }

        if (hasLink || hasBadWord || hasFlood || hasLockedMedia || hasMassMention || hasAnyMention || hasTagAll || hasMassForward || hasRepeat) {
          // 🔍 لوج تشخيصي: يطبع بالتيرمينال بالضبط أي سبب فعّل الحذف/الإنذار (يساعدنا نلقط أي خطأ فوراً)
          console.log(
            `[حماية] حذف/إنذار لـ ${sender.split('@')[0]} بقروب ${from} — الأسباب: ` +
              JSON.stringify({
                hasLink, hasBadWord, hasFlood, hasLockedMedia,
                hasMassMention, hasAnyMention, hasTagAll, hasMassForward, hasRepeat,
              }) +
              ` | نص الرسالة: ${(text || '').slice(0, 80)}`
          );
          if (hasLink || hasBadWord || hasLockedMedia || hasMassMention || hasAnyMention || hasTagAll || hasMassForward || hasRepeat) {

            try {
              await sock.sendMessage(from, { delete: msg.key });
            } catch (e) {
              console.log('⚠️ ما قدرت أحذف الرسالة (البوت لازم يكون أدمن):', e.message);
            }
          }

          // 🛡️ حماية من المتجر: عضو البريميوم محصّن، أو صاحب تذكرة حماية بتُستهلك بدل الإنذار
          const shieldEntry = getShopEntry(sender);
          if (isPremiumActive(shieldEntry)) {
            await sock.sendMessage(from, {
              text: `💠 @${sender.split('@')[0]} عندك حصانة VIP، ما انحسب عليك إنذار هالمرة (بس الرسالة انحذفت لو كانت مخالفة).`,
              mentions: [sender],
            });
            return;
          }
          if (shieldEntry.warnShields > 0) {
            shieldEntry.warnShields -= 1;
            saveShop();
            await sock.sendMessage(from, {
              text: `🛡️ @${sender.split('@')[0]} استخدمت تذكرة حماية وما انحسب عليك إنذار! باقيلك *${shieldEntry.warnShields}* تذكرة/تذاكر.`,
              mentions: [sender],
            });
            return;
          }

          if (!warnings[from]) warnings[from] = {};
          warnings[from][sender] = (warnings[from][sender] || 0) + 1;
          saveJSON(WARN_FILE, warnings);

          const count = warnings[from][sender];
          const warnLimit = (protectionSettings[from] && protectionSettings[from].warnLimit) || 3;
          const reason = hasLink
            ? 'إرسال رابط ممنوع'
            : hasBadWord
              ? 'استخدام ألفاظ غير لائقة'
              : hasLockedMedia
                ? 'إرسال وسائط والقروب مقفول عليها'
                : hasAnyMention
                  ? 'المنشن ممنوع نهائياً بهاد القروب'
                  : hasTagAll
                    ? 'محاولة منشن "الكل" بدون صلاحية أدمن'
                    : hasMassMention
                    ? `منشن جماعي مشبوه (${mentionedCount} شخص برسالة وحدة)`
                    : hasMassForward
                      ? 'رسالة متداولة كتير (تشين/سبام جاهز)'
                      : hasRepeat
                        ? 'تكرار نفس الرسالة أكتر من مرتين'
                        : 'إرسال رسائل متكررة بسرعة (سبام)';

          const senderDigits = sender.split('@')[0];

          if (count >= warnLimit) {
            try {
              await sock.groupParticipantsUpdate(from, [sender], 'remove');
              const caption =
                `🚔 ✦ *طرد نهائي من السجن!* ✦\n` +
                `@${senderDigits}\n` +
                `السبب: تجاوز ${warnLimit} إنذارات (${reason})\n` +
                `🔒 العقوبة: طرد نهائي من القروب`;
              try {
                const jailImage = await buildJailCard(await fetchProfilePicBuffer(sock, sender), senderDigits);
                await sock.sendMessage(from, { image: jailImage, caption, mentions: [sender] });
              } catch (e) {
                console.log('⚠️ ما قدرت أبني صورة السجن (طرد):', e.message);
                await sock.sendMessage(from, { text: caption, mentions: [sender] });
              }
            } catch (e) {
              await sock.sendMessage(from, {
                text: `⚠️ تجاوز الشخص ${warnLimit} إنذارات بس ما قدرت أطرده، تأكد إن البوت أدمن.`,
              });
            }
            delete warnings[from][sender];
            saveJSON(WARN_FILE, warnings);
          } else {
            // 🔒 عقوبة كتم تلقائية بالوقت (تتصاعد مع كل إنذار)، مرفقة بصورة سجن
            const muteMinutes = Math.min(60, count * 5);
            if (!mutedUsers[from]) mutedUsers[from] = {};
            mutedUsers[from][pointsKey(sender)] = Date.now() + muteMinutes * 60 * 1000;
            saveMutes();
            const releaseTime = new Date(Date.now() + muteMinutes * 60 * 1000).toLocaleTimeString('ar-EG', {
              hour: '2-digit',
              minute: '2-digit',
            });

            const caption =
              `🚔 ✦ *دخل السجن!* ✦\n` +
              `@${senderDigits}\n` +
              `⚠️ إنذار ${count}/${warnLimit}\n` +
              `السبب: ${reason}\n` +
              `🔒 مدة العقوبة: ${muteMinutes} دقيقة (رسائله رح تنحذف تلقائياً لحد الإفراج الساعة ${releaseTime})\n` +
              `${warnLimit - count} إنذار متبقي قبل الطرد النهائي.`;

            try {
              const jailImage = await buildJailCard(await fetchProfilePicBuffer(sock, sender), senderDigits);
              await sock.sendMessage(from, { image: jailImage, caption, mentions: [sender] });
            } catch (e) {
              console.log('⚠️ ما قدرت أبني صورة السجن (إنذار):', e.message);
              await sock.sendMessage(from, { text: caption, mentions: [sender] });
            }
          }
          return;
        }
      }

      // ==== أوامر عامة ====
      if (command === '.مرحبا' || command === 'hi') {
        await sock.sendMessage(from, { text: `👋 ✦ *أهلاً فيك! معك ${BOT_PROFILE_NAME}* ✦` });
      } else if (command === '.تنصيب') {
        const rawArg = (args[0] || '').trim();
        const phoneDigits = rawArg.replace(/[^\d]/g, '');

        if (!phoneDigits) {
          // بدون رقم: نعرض شرح خطوات التنصيب اليدوي
          await sock.sendMessage(from, {
            text:
              `📥 ✦ *خطوات تنصيب البوت (Termux + Node.js)* ✦\n\n` +
              `1️⃣ حمّل تطبيق *Termux* (يفضّل من F-Droid)\n\n` +
              `2️⃣ حدّث الحزم:\n` +
              `\`pkg update && pkg upgrade -y\`\n\n` +
              `3️⃣ ثبّت Node.js وGit:\n` +
              `\`pkg install nodejs git -y\`\n\n` +
              `4️⃣ حمّل ملفات البوت (أو انسخها لمجلد على الجهاز):\n` +
              `\`cd ~ && mkdir mybot && cd mybot\`\n\n` +
              `5️⃣ ثبّت المكتبات المطلوبة:\n` +
              `\`npm install @whiskeysockets/baileys pino dotenv jimp qrcode-terminal\`\n\n` +
              `6️⃣ شغّل البوت:\n` +
              `\`node index.js\`\n\n` +
              `7️⃣ امسح كود QR اللي بيطلع بواتساب من جهازك (الأجهزة المرتبطة)\n\n` +
              `💡 أو اكتب *.تنصيب <رقمك مع كود الدولة>* وبنبعت طلبك للأدمن، وبمجرد ما يوافق بتوصلك كود اقتران تربط فيه بوت جديد برقمك\n\n` +
              `⚠️ *ملاحظات مهمة:*\n` +
              `• لازم تحط مفتاح Gemini API الخاص فيك بمكان آمن (متغير بيئة .env) مش مكتوب صريح بالكود\n` +
              `• رقمك كأدمن رئيسي لازم تحطه بمصفوفة ADMINS بأول الملف\n` +
              `• خلي الجهاز أو السيرفر شغال باستمرار حتى يضل البوت متصل\n\n` +
              `💡 اكتب .مساعدة لتشوف كل أوامر البوت بعد ما يشتغل`,
          });
          return;
        }

        // مع رقم: منسجل طلب تنصيب وننتظر موافقة الأدمن قبل ما نطلب كود الاقتران
        if (phoneDigits.length < 8 || phoneDigits.length > 15) {
          await sock.sendMessage(from, {
            text: '⚠️ الرقم مش صحيح. اكتبه مع كود الدولة وبدون + أو 00، مثال: .تنصيب 9665xxxxxxxx',
          });
          return;
        }

        const existing = activeInstalls.get(phoneDigits);
        if (existing && existing.status !== 'failed' && existing.status !== 'rejected') {
          const statusText = existing.status === 'connected'
            ? 'صار عندو بوت شغال ومربوط ✅'
            : existing.status === 'code_sent'
              ? 'انبعتله كود اقتران أصلاً، خليه يدخله بواتساب'
              : existing.status === 'awaiting_approval'
                ? 'طلبه لسا تحت مراجعة الأدمن ⏳'
                : 'طلب تنصيب شغال أصلاً وقاعد ينجهز';
          await sock.sendMessage(from, {
            text: `⏳ هاد الرقم عنده طلب تنصيب موجود أصلاً: ${statusText}`,
          });
          return;
        }

        activeInstalls.set(phoneDigits, { status: 'awaiting_approval', requester: sender, from });
        await sock.sendMessage(from, {
          text: `📨 ✦ *تم إرسال طلبك!* ✦\n\nطلب تنصيب بوت لرقم *${phoneDigits}* تحت مراجعة الأدمن الآن، رح توصلك رسالة أول ما يوافق عليه ⏳`,
        });

        // ---- 📥 إشعار الموافقة: لو الطلب صار جوا قروب، بيوصل لأدمنية هاد القروب مباشرة بنفس الشات؛ لو من الخاص، بيوصل لأدمنية البوت العامين ----
        if (isGroup) {
          try {
            const groupMeta = await sock.groupMetadata(from);
            const groupAdmins = groupMeta.participants
              .filter((p) => p.admin === 'admin' || p.admin === 'superadmin')
              .map((p) => p.id);
            await sock.sendMessage(from, {
              text:
                `📥 ✦ *طلب تنصيب بوت جديد* ✦\n\n` +
                `👤 من: @${sender.split('@')[0]}\n` +
                `📱 الرقم المطلوب: *${phoneDigits}*\n\n` +
                `⚠️ أدمنية القروب فقط يقدروا يردوا:\n` +
                `✅ للموافقة: .قبول_تنصيب ${phoneDigits}\n` +
                `❌ للرفض: .رفض_تنصيب ${phoneDigits}`,
              mentions: [sender, ...groupAdmins],
            });
          } catch (e) {
            console.log('⚠️ ما قدرت أجيب أدمنية القروب، بستخدم أدمنية البوت العامين:', e.message);
            for (const adminJid of ADMINS) {
              try {
                await sock.sendMessage(adminJid, {
                  text:
                    `📥 ✦ *طلب تنصيب بوت جديد* ✦\n\n` +
                    `👤 من: @${sender.split('@')[0]}\n` +
                    `📱 الرقم المطلوب: *${phoneDigits}*\n\n` +
                    `✅ للموافقة: .قبول_تنصيب ${phoneDigits}\n` +
                    `❌ للرفض: .رفض_تنصيب ${phoneDigits}`,
                  mentions: [sender],
                });
              } catch (e2) {
                console.log('⚠️ ما قدرت أبعت إشعار طلب التنصيب للأدمن:', adminJid, e2.message);
              }
            }
          }
        } else {
          // طلب من الخاص: ما في مفهوم "أدمن قروب"، فبيوصل لأدمنية البوت العامين متل السابق
          for (const adminJid of ADMINS) {
            try {
              await sock.sendMessage(adminJid, {
                text:
                  `📥 ✦ *طلب تنصيب بوت جديد* ✦\n\n` +
                  `👤 من: @${sender.split('@')[0]}\n` +
                  `📱 الرقم المطلوب: *${phoneDigits}*\n\n` +
                  `✅ للموافقة: .قبول_تنصيب ${phoneDigits}\n` +
                  `❌ للرفض: .رفض_تنصيب ${phoneDigits}`,
                mentions: [sender],
              });
            } catch (e) {
              console.log('⚠️ ما قدرت أبعت إشعار طلب التنصيب للأدمن:', adminJid, e.message);
            }
          }
        }
      }

      // ---- ✅ موافقة الأدمن على طلب تنصيب رقم جديد (أدمن القروب اللي انطلب فيه، أو أدمنية البوت لو الطلب من الخاص) ----
      else if (command === '.قبول_تنصيب') {
        const phoneDigits = (args[0] || '').replace(/[^\d]/g, '');
        const entry = activeInstalls.get(phoneDigits);
        if (!entry || entry.status !== 'awaiting_approval') {
          await sock.sendMessage(from, { text: '⚠️ ما لقيت طلب تنصيب بانتظار الموافقة بهاد الرقم.' });
          return;
        }
        const requestIsGroup = entry.from.endsWith('@g.us');
        const allowed = requestIsGroup ? await isAdminOrOwner(sock, entry.from, sender) : isBotOwner(sender);
        if (!allowed) {
          await sock.sendMessage(from, { text: '⛔ بس أدمن القروب اللي انطلب فيه (أو أدمنية البوت) يقدروا يوافقوا.' });
          return;
        }

        activeInstalls.set(phoneDigits, { ...entry, status: 'pending' });
        await sock.sendMessage(from, { text: `✅ تمت الموافقة، عم أجهز كود الاقتران لرقم *${phoneDigits}*...` });
        try {
          await sock.sendMessage(entry.from, {
            text: `✅ ✦ *تمت الموافقة على طلبك!* ✦\n\nعم أجهزلك كود الاقتران لرقم *${phoneDigits}*... استنى شوي 🔄`,
            mentions: [entry.requester],
          });
        } catch (e) {
          console.log('⚠️ ما قدرت أبعت إشعار الموافقة للطالب:', e.message);
        }

        const authFolder = `sessions/${phoneDigits}`;
        startBotInstance(authFolder, phoneDigits, async (code) => {
          activeInstalls.set(phoneDigits, { ...entry, status: 'code_sent' });
          try {
            await sock.sendMessage(entry.from, {
              text:
                `🔑 ✦ *كود الاقتران جاهز!* ✦\n\n` +
                `الرقم: *${phoneDigits}*\n` +
                `الكود: *${code}*\n\n` +
                `📱 روح لواتساب على جهاز هاد الرقم > الإعدادات > الأجهزة المرتبطة > ربط جهاز > ربط برقم الهاتف بدل QR، وأدخل الكود فوق خلال ثواني قبل لا ينتهي.\n\n` +
                `✅ بعد ما تربطه، بيصير عندك نسخة بوت مستقلة شغالة على رقمك بنفس كل الأوامر.`,
              mentions: [entry.requester],
            });
          } catch (e) {
            console.log('⚠️ ما قدرت أبعت الكود للطالب:', e.message);
          }

          // ==== ⏰ إذا ما ربط الكود خلال المهلة، نذكّره إنو الكود انتهت صلاحيته ====
          setTimeout(async () => {
            const current = activeInstalls.get(phoneDigits);
            if (!current || current.status !== 'code_sent') return; // ربط بنجاح أو تغيرت الحالة أصلاً
            activeInstalls.set(phoneDigits, { ...current, status: 'failed' });
            try {
              await sock.sendMessage(entry.from, {
                text:
                  `⌛ ✦ *انتهت صلاحية كود الاقتران!* ✦\n\n` +
                  `يبان ما ربطت رقم *${phoneDigits}* بالوقت المحدد.\n` +
                  `اكتب *.تنصيب ${phoneDigits}* من جديد عشان تطلب كود جديد.`,
                mentions: [entry.requester],
              });
            } catch (e) {
              console.log('⚠️ ما قدرت أبعت تذكير انتهاء صلاحية الكود:', e.message);
            }
          }, 2 * 60 * 1000); // مهلة دقيقتين
        }).catch((e) => {
          activeInstalls.set(phoneDigits, { ...entry, status: 'failed' });
          console.log(`⚠️ فشل تنصيب رقم جديد (${phoneDigits}):`, e.message);
        });
      }

      // ---- ❌ رفض الأدمن لطلب تنصيب رقم جديد (نفس صلاحية الموافقة) ----
      else if (command === '.رفض_تنصيب') {
        const phoneDigits = (args[0] || '').replace(/[^\d]/g, '');
        const entry = activeInstalls.get(phoneDigits);
        if (!entry || entry.status !== 'awaiting_approval') {
          await sock.sendMessage(from, { text: '⚠️ ما لقيت طلب تنصيب بانتظار الموافقة بهاد الرقم.' });
          return;
        }
        const requestIsGroup = entry.from.endsWith('@g.us');
        const allowed = requestIsGroup ? await isAdminOrOwner(sock, entry.from, sender) : isBotOwner(sender);
        if (!allowed) {
          await sock.sendMessage(from, { text: '⛔ بس أدمن القروب اللي انطلب فيه (أو أدمنية البوت) يقدروا يرفضوا.' });
          return;
        }
        activeInstalls.set(phoneDigits, { ...entry, status: 'rejected' });
        await sock.sendMessage(from, { text: `❌ تم رفض طلب التنصيب لرقم *${phoneDigits}*.` });
        try {
          await sock.sendMessage(entry.from, {
            text: `❌ للأسف الأدمن رفض طلب تنصيب البوت لرقم *${phoneDigits}*.`,
            mentions: [entry.requester],
          });
        } catch (e) {
          console.log('⚠️ ما قدرت أبعت إشعار الرفض للطالب:', e.message);
        }
      }

      // ---- 📋 قائمة كل الأرقام يلي ربطت بوت ناجح عبر .تنصيب ----
      else if (command === '.تست') {
        if (!isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '⛔ هاد الأمر حصراً للأدمن الرئيسي.' });
          return;
        }

        const connected = [];
        for (const [phoneDigits, entry] of activeInstalls.entries()) {
          if (entry.status === 'connected') connected.push({ phoneDigits, ...entry });
        }

        if (connected.length === 0) {
          await sock.sendMessage(from, { text: '📋 ما فيه ولا رقم ربط بوت لحد هلأ.' });
          return;
        }

        const lines = connected.map((entry, i) => {
          const dateStr = entry.connectedAt
            ? new Date(entry.connectedAt).toLocaleString('ar-DZ', { dateStyle: 'short', timeStyle: 'short' })
            : 'غير معروف';
          return `${i + 1}. 📱 *${entry.phoneDigits}* — ربط بتاريخ: ${dateStr}`;
        });

        await sock.sendMessage(from, {
          text: `📋 ✦ *الأرقام يلي ربطت بوت بنجاح (${connected.length})* ✦\n\n${lines.join('\n')}`,
        });
      } else if (command === '.مساعدة' || command === '.help' || command === '.مساعدة_نص') {
        const section = (args[0] || '').trim();
        // ==== 📋 .مساعدة تعتمد دايماً على النص (موثوق 100% على كل الأجهزة) ====
        // الأزرار التفاعلية (.القائمة) طريقة غير رسمية بمكتبة Baileys وبتفشل بصمت (بدون خطأ) على بعض
        // نسخ واتساب — فما نقدر نعتمد عليها كخيار افتراضي، خليناها تجربة اختيارية بس تحت أمر .القائمة

        const sections = {
          'عام': {
            emoji: '🌟',
            title: 'عام',
            body:
              '.مرحبا  .الوقت  .ping  .تنصيب\n' +
              '📢 .قناتنا — بطاقة قناتنا الرسمية بواتساب\n' +
              '.سرعة  .تنظيف  .ستيكر  .صورة\n' +
              '.تشغيل <اسم أو رابط يوتيوب> — ينزل ويبعت أغنية وحدة مباشرة (أو من رابط)\n' +
              '.فيديو  .بنترست  .استخراج_صوت\n' +
              '.apk <اسم تطبيق>  .حزمة <موضوع>\n' +
              '.اقتباس  .الطقس  🤖 .اسأل  .ip\n' +
              '✨ .كلود  🖼️ .حلل_صورة  🧹 .مسح_الذاكرة\n' +
              '🔎 .بحث_ذكي <سؤال> — بحث بالنت + رد مصاغ بالذكاء الاصطناعي (غير .بحث اللي بيجيب ملخص ويكيبيديا مباشر)\n' +
              '📚 ذكاءك الخاص: .تعليم سؤال|جواب (المالك) — وبعدها بيرد تلقائي بدون أمر لو حدا سأل نفس السؤال\n' +
              '.بوتي (سؤال يدوي)  .معرفتي  .نسيان\n' +
              '📊 .كوتتي — رصيدك المتبقي من كوتا الذكاء الاصطناعي اليومية\n' +
              '🎙️ .تحدث (رد على ملاحظة صوتية)\n' +
              '🔊 .نطق <اسم_الصوت> <نص> — يحوله لصوت (📋 .اصوات لكل الأصوات)\n' +
              '📌 .تثبيت (رد على رسالة) — يثبتها بالقروب [أدمن]\n' +
              '📌 .الغاء_تثبيت (رد على رسالة مثبتة) [أدمن]\n' +
              '.ترجم  .لخص  .صحح  .حاسبة\n' +
              '💻 .اكتب_كود  📄 .حلل_ملف\n' +
              '.qr  .اختصار_رابط\n' +
              '.معلومات_القروب  .قائمة_الادمن  .احصائيات\n' +
              '👨‍💻 .المطور',
          },
          'العاب': {
            emoji: '🎮',
            title: 'الألعاب',
            body:
              '.تخمين  .سؤال  .حساب  .فك_الكلمة\n' +
              '.سباق  .تحدي  .اختر  .عملة  .نرد\n' +
              '.لغز  .صح_خطأ  .تخمين_الدولة\n' +
              '.اكمل_مثل  .خمن_شخصية  .كلمة_ناقصة\n' +
              '.تصنيف  .استسلم\n\n' +
              '⭕❌ .اكس_او @شخص — لعبة اكس أو 1 ضد 1\n' +
              'اكتب رقم الخانة (1-9) مباشرة، أو .حرك <رقم>\n\n' +
              '🎯 .مشنقة — لعبة المشنقة الجماعية (خمن حروف كلمة سرية)\n' +
              'اكتب حرف عربي مباشرة للتخمين، أو .استسلام_مشنقة\n\n' +
              '🔗 .سلسلة_كلمات — كل كلمة تبلش بآخر حرف من اللي قبلها\n' +
              'اكتب كلمتك مباشرة، أو .انهاء_سلسلة\n\n' +
              '💎 .صراحة — لعبة أسئلة صراحة بالدور (📋 .مساعدة_صراحة)\n\n' +
              '🕵️ *مافيا (جماعية، عن طريق الخاص):*\n' +
              '_⚔️ نسخة أسطورية من طرف فيروس أمونس الخطير ⚔️_\n' +
              '.مافيا_ابدأ (أو اختصار: .مافيا_يلا)  .مافيا_انضم  .مافيا_الغاء\n' +
              '🧍 .مافيا_فردي [عدد] ← تلعب لحالك ضد لاعبين آليين (.مافيا_بدء_الآن يبلشها فوراً)\n' +
              'بالخاص وقت دورك: .قتل / .حماية / .تحقيق / .قنص / .تهريب <رقم>\n' +
              'بالقروب وقت التصويت: .تصويت <رقم أو منشن>  .الغاء_تصويت\n' +
              '🦠 .متجر_المافيا ← أغراض أسطورية تقوّيك باللعبة (درع، بعث، تمويه...)\n' +
              '📋 .مساعدة_مافيا لشرح القواعد بالتفصيل (فيها أدوار جديدة!)\n\n' +
              '📋 .قائمة_الالعاب لكل التفاصيل\n' +
              '🎉 .فعالية ← ألعاب متتالية تلقائياً\n' +
              '🛑 .انهاء_الفعالية ← توقفها\n\n' +
              '⚔️ .مساعدة قتال ← مبارزات وحروب جماعية',
          },
          'قتال': {
            emoji: '⚔️',
            title: 'المبارزات والحروب الجماعية',
            body:
              '⚔️ *مبارزة 1 ضد 1 (أسئلة صعبة!):*\n' +
              '.مبارزة @شخص — تبدأ مبارزة (كل واحد 10 ❤️)\n' +
              '❓ جاوب صح على السؤال الصعب حتى *تفتح حركة*\n' +
              '🎯 بعدها اختار: .هجوم ⚔️ أو .دفاع 🛡️ أو .شفاء 💚\n' +
              '.متجر_المعركة — متجر ضخم 20 غرض (هجومية/دفاعية/علاجية/اقتصادية/أسطورية)\n' +
              '.شراء_معركة <معرف> — اشتري غرض بالذهب اللي كسبته\n' +
              '💚 الشفاء مجاني مرتين بالمبارزة، وبعدها لازم تشتري جرعة\n\n' +
              '💀 *حرب جماعية بالقروب:*\n' +
              '.بدء_حرب [ثواني] — الأدمن يبدأها (مهلة انضمام دقيقة افتراضياً، أو مدة مخصصة)\n' +
              '.انضم — تشارك بالحرب\n' +
              '.هجوم @شخص — تهاجم مشارك محدد (كولداون 15 ثانية)\n' +
              '.حالة_الحرب — تشوف مين لسا ناجي\n' +
              '.الغاء_حرب — الأدمن يلغيها بمرحلة الانضمام\n\n' +
              '🏰 *برج التحدي الأسطوري (فردي):*\n' +
              '.برج_التحدي — تبدأ/تكمل التسلق وتحارب وحش الطابق\n' +
              '.انسحاب_البرج — تنزل غنيمتك كنقاط قبل ما تخاطر أكتر\n' +
              '⚠️ لو مت جوا البرج بتخسر كل الغنيمة يلي ما نزلتها!\n\n' +
              '🎡 *عجلة الحظ الملكية (مقامرة):*\n' +
              '.عجلة_الحظ <رهان> — راهن بنقاطك ودور العجلة (مضاعفات من ×0 لـ×10 نادرة)\n\n' +
              '⚠️ لعب منظم: أي غش (دور غلط، هجوم بدون كولداون، هجوم عالفاضي) إنذار، وتكرارو طرد تلقائي (خسارة فورية).',
          },
          'نقاط': {
            emoji: '🏅',
            title: 'النقاط والجوائز',
            body:
              '🎁 .هدية_يومية — نقاط مجانية كل يوم + بونص لو رجعت أيام متتالية بلا انقطاع\n\n' +
              '.نقاطي — نقاطك ورتبتك\n' +
              '.نقاط @شخص — نقاط شخص معيّن\n' +
              '.تحويل @شخص <عدد> — تهدي نقاط لصديقك\n' +
              '.الترتيب — أفضل 10 لاعبين عالمياً\n' +
              '.احصائيات — أفضل لاعبين بهاد القروب\n' +
              '.الجوائز — كل الرتب والمستويات\n' +
              '🆕 .انجازاتي — إنجازاتك المفتوحة والمقفولة\n\n' +
              '🏆 *لوحة الصدارة الأسبوعية (جديد):*\n' +
              '.المتصدرين_الاسبوع — أفضل 10 هالأسبوع بس (تصفّر كل أحد تلقائياً)\n' +
              '📜 .ارشيف_الابطال — أبطال آخر 5 أسابيع فائتة',
          },
          'اقتصاد': {
            emoji: '💼',
            title: 'وظائف واستثمار',
            body:
              '💼 .وظيفة — تشوف الوظائف المتاحة وتختار وحدة\n' +
              '💰 .اشتغل — تكسب نقاط من وظيفتك (مرة كل ساعة)\n' +
              '📈 .استثمار <عدد> — تخاطر بنقاطك لتضاعفها أو تخسر جزء منها\n' +
              '📝 .سيرتي <نص> — تحدد سيرة ذاتية تظهر ببروفايلك',
          },
          'اجتماعي': {
            emoji: '💍',
            title: 'زواج وعلاقات افتراضية',
            body:
              '💍 .زواج @شخص — تطلب تتزوج حدا (يحتاج موافقته)\n' +
              '🎰 .زواج (من دون منشن) — زواج عشوائي فوري من عضو عشوائي بالقروب، للمرح!\n' +
              '💒 .قبول_الزواج — توافق على طلب معلّق إلك\n' +
              '💔 .رفض_الزواج — ترفض طلب معلّق إلك\n' +
              '💔 .طلاق — تنفصل عن شريكك الحالي\n' +
              '💑 .زوجي / .شريكي [@شخص] — تشوف الحالة الزوجية',
          },
          'متجر': {
            emoji: '🛒',
            title: 'متجر النقاط',
            body:
              '.المتجر — تشوف كل الأغراض المتاحة\n' +
              '.شراء لقب <النص> — شراء لقب مخصص\n' +
              '.شراء اسم_مستعار <النص> — شراء اسم مستعار\n' +
              '.شراء <معرف> — شراء وسام/إطار/مضاعفة/بريميوم/حماية/صندوق حظ/لقب يومي/حيوان أليف\n' +
              '.تفعيل_وسام <معرف> — تبديل الوسام النشط\n' +
              '.تفعيل_اطار <معرف> — تبديل الإطار النشط\n' +
              '.تفعيل_حيوان <معرف> — تبديل الحيوان الأليف النشط\n' +
              '.حيواناتي — تشوف حيواناتك الأليفة الحصرية\n' +
              '.مقتنياتي — تشوف كل اللي اشتريته\n' +
              '.بروفايلي — بروفايلك بصورتك ولقبك\n' +
              '.بروفايل @شخص — بروفايل شخص معيّن\n' +
              '💳 .بطاقتي — بطاقة بنك أمونس (نقاطك ورتبتك بشكل بطاقة بنكية)\n' +
              '.عرض_اليوم — غرض عشوائي بخصم، بيتغير يومياً\n' +
              '.بدء_مزاد — يبدأ مزاد على غرض نادر (أدمن، بالقروبات)\n' +
              '.مزاد — يعرض حالة المزاد الحالي\n' +
              '.مزايدة <عدد> — تزايد على المزاد الحالي\n\n' +
              '💠 *3 فئات VIP بريميوم:* فضي (×2) / ذهبي (×3) / ماسي (×4)\n' +
              '💠 *أوامر حصرية لأعضاء VIP بريميوم:*\n' +
              '.احصائياتي_VIP — إحصائيات مفصلة\n' +
              '.اسأل_VIP <سؤال> — سؤال ذكاء اصطناعي حصري',
          },
          'مرح': {
            emoji: '🎁',
            title: 'مرح وأدوات',
            body:
              '.حظ  .نكتة  .لون  .اسم_مستعار\n' +
              '.توقع  .تقييم  .توافق  .قرعة\n' +
              '.اختر_عشوائي  .عكس  .تشفير\n' +
              '.فك_تشفير  .مورس  .عد_الاحرف\n' +
              '.عمر  .يوم  .تحويل_طول\n' +
              '.تحويل_وزن  .تحويل_حرارة\n' +
              '.تصويت  .تذكير <دقائق> <نص>\n' +
              '.تذكير_يومي <س> <د> <نص> — تذكير متكرر\n' +
              '.تذكيراتي — تذكيراتك النشطة\n' +
              '.الغاء_تذكير <رقم>\n' +
              '.تحويل_عملة <مبلغ> <من> <الى>\n' +
              '.بحث <كلمة> — بحث سريع بويكيبيديا\n' +
              '.تاريخ_هجري — تحويل التاريخ الهجري/الميلادي\n' +
              '.هل_تعلم  .تحدي_اليوم\n' +
              '.عجلة_الحظ  .رقم_الحظ <رقم>\n' +
              '.مين_احتمال <سؤال>',
          },
          'دين': {
            emoji: '🕌',
            title: 'مواقيت الصلاة والأذكار',
            body:
              '.اضف_صلاة  .حذف_صلاة  .صلوات\n' +
              '.تفعيل_الصلاة_على_النبي\n' +
              '.تعطيل_الصلاة_على_النبي\n' +
              '.اذكار  .تفعيل_الاذكار  .تعطيل_الاذكار',
          },
          'ادارة': {
            emoji: '👮',
            title: 'إدارة القروب (أدمن)',
            body:
              '.كيك / .طرد  .ترقية  .تنزيل  .حذف\n' +
              '.كيك_الكل @شخص1 @شخص2 — طرد أكتر من عضو دفعة وحدة\n' +
              '.وضع_الموافقة تشغيل/ايقاف — لازم موافقتك حتى ينضم عضو جديد\n' +
              '.قبول_عضو / .رفض_عضو @شخص أو رقمه — للردّ على طلبات الانضمام\n' +
              '.قفل  .فتح  .حظر  .رفع_حظر\n' +
              '.قائمة_المحظورين  .اسم_القروب\n' +
              '.وصف_القروب  .رابط  .تحديث_رابط\n' +
              '.منشن_الكل  .انذار  .مسح_الانذارات\n' +
              '🆕 .كتم @شخص [دقائق]  .الغاء_كتم @شخص\n' +
              '🆕 .الوضع_البطيء [ثواني]  .الغاء_البطيء\n\n' +
              '⚠️ ملاحظة: لازم البوت نفسه يكون أدمن بالقروب حتى تشتغل أوامر الطرد/الترقية/الإنزال.',
          },
          'حماية': {
            emoji: '🛡️',
            title: 'حماية القروب (أدمن)',
            body:
              '.حماية_الروابط  .حماية_الالفاظ\n' +
              '.حماية_السبام  .حماية_الحذف\n' +
              '.قفل_الوسائط  .حالة_الحماية\n' +
              '🆕 .حماية_المنشن — منشن جماعي مشبوه (+5 أشخاص)\n' +
              '🆕 .منع_المنشن — منع أي منشن نهائياً (حتى لشخص وحيد)\n' +
              '🔒 كتابة "@الكل" أو "@all" ممنوعة دايماً على غير الأدمن (بدون ما تحتاج تفعيل)\n' +
              '🆕 .حماية_التداول — رسائل متداولة كتير (تشين)\n' +
              '🆕 .حماية_التكرار — نفس الرسالة مكررة\n' +
              '🆕 .حد_الانذارات <1-10> — عدد الإنذارات قبل الطرد\n\n' +
              '.الحماية تشغيل/ايقاف — يفعّل/يوقف كل الأنواع دفعة وحدة\n' +
              '.الحماية_الشاملة — أقصى درجة حماية فوراً (بضغطة وحدة)\n\n' +
              'الصيغة: أمر + (تشغيل / ايقاف)\n' +
              '🔒 .قفل / .فتح — يقفل/يفتح كتابة القروب للأدمن بس',
          },
          'مالك': {
            emoji: '🔌',
            title: 'مالك البوت',
            body:
              '.ايقاف_البوت  .تشغيل_البوت  .الغاء_حظر_الكل\n\n' +
              '🏢 .تمويل_الشركة <عدد> [@شخص] — تموّل نقاطك أو نقاط شخص ثاني مباشرة من خزينة الشركة (بلا حدود)\n' +
              '🩺 .فحص_النظام — تقرير كامل: هل الصور/الحفظ/الاتصال/أدمنية البوت شغالين صح\n' +
              '🔁 .اعادة_تشغيل — يحفظ كل البيانات ويوقف العملية (بترجع تشغلها يدوي من Termux)\n\n' +
              '📊 .احصائيات_الاستخدام — أكثر الأوامر استخداماً\n' +
              '💾 .نسخة_احتياطية — نسخة فورية لبيانات البوت\n' +
              '💾 .تفعيل_النسخ_التلقائي / .تعطيل_النسخ_التلقائي — نسخ يومي تلقائي\n' +
              '👁️ .تفعيل_مراقبة_المشاهدة / .تعطيل_مراقبة_المشاهدة — رسائل المشاهدة الواحدة (مطفية افتراضياً لحماية الخصوصية)\n\n' +
              '📢 .اذاعة <نص> — يبعت رسالة لكل القروبات المتصلة دفعة وحدة\n' +
              '🔄 .تصفير_كوتا @شخص — يصفّر كوتا الذكاء الاصطناعي اليومية لشخص معيّن',
          },
        };

        // اختصارات لأسماء الأقسام (بالعربي أو الإنجليزي)
        const aliases = {
          general: 'عام', games: 'العاب', الألعاب: 'العاب', points: 'نقاط',
          shop: 'متجر', store: 'متجر',
          fight: 'قتال', battle: 'قتال', duel: 'قتال', war: 'قتال', مبارزة: 'قتال', حرب: 'قتال',
          fun: 'مرح', religion: 'دين', اذكار: 'دين', admin: 'ادارة',
          protection: 'حماية', security: 'حماية', owner: 'مالك',
        };
        const key = aliases[section] || section;

        if (key && sections[key]) {
          const s = sections[key];
          await sock.sendMessage(from, {
            text: buildHelpSectionBox(s.emoji, s.title, s.body),
            contextInfo: await getChannelContextInfo(sock),
          });
          return;
        }

        // القائمة الرئيسية: مختصرة، أقسام بس (بسيط من برا، تفاصيل جوا كل قسم)
        const menuText =
          `👑 *${BOT_NAME}* 👑\n` +
          '━━━━━━━━━━━━━━\n\n' +
          '📂 *الأقسام:*\n' +
          '🌟عام 🎮العاب ⚔️قتال 🏅نقاط\n' +
          '💼اقتصاد 💍اجتماعي 🛒متجر 🎁مرح\n' +
          '🕌دين 👮ادارة 🛡️حماية 🔌مالك\n\n' +
          '✍️ اكتب: *.مساعدة <اسم القسم>*\n' +
          'مثال: .مساعدة العاب\n\n' +
          '📢 قناتنا الرسمية: .قناتنا\n' +
          '👨‍💻 مشكلة أو اقتراح؟ .المطور\n' +
          `━━━━━━━━━━━━━━\n💎 ${DEVELOPER_NAME}`;

        const logoVideoPath = '/data/data/com.termux/files/home/mybot/logo.mp4';
        const logoImagePath = '/data/data/com.termux/files/home/mybot/logo.png';
        const menuContextInfo = await getChannelContextInfo(sock);

        if (fs.existsSync(logoVideoPath)) {
          await sock.sendMessage(from, { video: fs.readFileSync(logoVideoPath), caption: menuText, gifPlayback: false, contextInfo: menuContextInfo });
        } else if (fs.existsSync(logoImagePath)) {
          await sock.sendMessage(from, { image: fs.readFileSync(logoImagePath), caption: menuText, contextInfo: menuContextInfo });
        } else {
          await sock.sendMessage(from, { text: menuText, contextInfo: menuContextInfo });
        }
      } else if (command.startsWith('.القائم') || command === '.قائمة' || command === '.list') {
        // ==== ⚠️ ملاحظة: الأزرار التفاعلية تجربة غير مضمونة (بتفشل بصمت على بعض نسخ واتساب بدون أي خطأ)
        // فبنضيف تعليمات نصية احتياطية جوا نفس الرسالة، حتى لو ما ظهرت الأزرار يضل في طريقة تستخدمها ====
        const sent = await sendSectionPicker(sock, from);
        if (!sent) {
          await sock.sendMessage(from, {
            text: '⚠️ ما قدرت أبعت القائمة (صار خطأ تقني). جرب .مساعدة بدلها.',
          });
        }
      } else if (command === '.رافن') {
        // ==== 📋 قائمة نصية بحتة (بدون أي interactiveButtons) — لأن واتساب صار يقفل الرسائل التفاعلية
        // بكل أنواعها (single_select و quick_reply و cta_url) على معظم الحسابات العادية غير الموثقة.
        // هذا الحل الوحيد المضمون 100% إنه يظهر عند كل مستخدم بأي نسخة واتساب ====
        const ravenMenuText =
          `⚡ *${BOT_PROFILE_NAME}* ⚡\n\n` +
          `اختر بكتابة رقم أو أمر:\n\n` +
          `1️⃣ ☰ اكتب *.القائمة* — كل الأقسام والأوامر\n` +
          `2️⃣ 👨‍💻 اكتب *.المطور* — تواصل مع المطور\n` +
          `3️⃣ 📢 اكتب *.قناتنا* — تابع آخر التحديثات\n\n` +
          `━━━━━━━━━━━━━━\n${BOT_NAME}`;
        await sock.sendMessage(from, {
          text: ravenMenuText,
          contextInfo: await getChannelContextInfo(sock),
        });
      } else if (command === '.الوقت') {
        await sock.sendMessage(from, {
          text: `🕐 ✦ *الوقت الحالي* ✦\n${new Date().toLocaleString('ar-EG')}`,
        });
      }

      // ==== 🏓 Ping - قياس سرعة الإنترنت وزمن استجابة البوت ====
      else if (command === '.ping' || command === '.سرعة') {
        const botStart = Date.now();
        let netLatency = 'غير متاح ❌';
        try {
          const { stdout } = await execPromise(
            `curl -o /dev/null -s -w "%{time_total}" https://www.google.com --max-time 8`
          );
          netLatency = `${Math.round(parseFloat(stdout) * 1000)} ms`;
        } catch (e) {
          // النت بطيء أو مقطوع
        }
        const botLatency = Date.now() - botStart;

        await sock.sendMessage(from, {
          text:
            `🏓 ✦ *Ping* ✦\n\n` +
            `⚡ سرعة الإنترنت: ${netLatency}\n` +
            `🤖 زمن استجابة البوت: ${botLatency} ms`,
        });
      }

      // ==== 🧹 تنظيف الملفات المؤقتة (مالك البوت فقط) ====
      else if (command === '.تنظيف') {
        if (!isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر لمالك البوت فقط.*' });
          return;
        }
        const result = cleanupTempFiles();
        await sock.sendMessage(from, {
          text:
            `🧹 ✦ *تم التنظيف* ✦\n\n` +
            `عدد الملفات المحذوفة: ${result.count}\n` +
            `المساحة المستردة: ${result.totalMB} MB`,
        });
      }

      // ==== 🎮 لعبة تخمين الرقم ====
      else if (command === '.تخمين') {
        const target = Math.floor(Math.random() * 200) + 1;
        numberGames[from] = { target, attempts: 0, maxAttempts: 8 };
        await sock.sendMessage(from, {
          text: '🎯 ✦ *لعبة تخمين الرقم* ✦\n\nخمّنت رقم بين 1 و200!\n🎯 عندك 8 محاولات بس، خليك دقيق!\nاكتب رقمك مباشرة (بدون أمر).\nاكتب .استسلم للانسحاب.',
        });
      } else if (command === '.استسلم') {
        if (numberGames[from]) {
          await sock.sendMessage(from, {
            text: `🏳️ خلصت اللعبة، الرقم كان: ${numberGames[from].target}`,
          });
          delete numberGames[from];
        } else if (quizGames[from]) {
          await sock.sendMessage(from, {
            text: `🏳️ خلص السؤال، الإجابة كانت: ${quizGames[from].answer}`,
          });
          delete quizGames[from];
        } else if (speedGames[from]) {
          await sock.sendMessage(from, {
            text: `🏳️ خلص السباق، الكلمة كانت: ${speedGames[from].word}`,
          });
          delete speedGames[from];
        } else if (mathGames[from]) {
          await sock.sendMessage(from, {
            text: `🏳️ خلصت اللعبة، الإجابة كانت: ${mathGames[from].answer}`,
          });
          delete mathGames[from];
        } else if (scrambleGames[from]) {
          await sock.sendMessage(from, {
            text: `🏳️ خلصت اللعبة، الكلمة كانت: ${scrambleGames[from].word}`,
          });
          delete scrambleGames[from];
        } else if (riddleGames[from]) {
          await sock.sendMessage(from, {
            text: `🏳️ خلص اللغز، الإجابة كانت: ${riddleGames[from].answer}`,
          });
          delete riddleGames[from];
        } else if (trueFalseGames[from]) {
          await sock.sendMessage(from, {
            text: `🏳️ خلصت اللعبة، الإجابة كانت: ${trueFalseGames[from].answer}`,
          });
          delete trueFalseGames[from];
        } else if (flagGames[from]) {
          await sock.sendMessage(from, {
            text: `🏳️ خلصت اللعبة، الدولة كانت: ${flagGames[from].name}`,
          });
          delete flagGames[from];
        } else if (proverbGames[from]) {
          await sock.sendMessage(from, {
            text: `🏳️ خلصت اللعبة، تكملة المثل كانت: ${proverbGames[from].answer}`,
          });
          delete proverbGames[from];
        } else if (figureGames[from]) {
          await sock.sendMessage(from, {
            text: `🏳️ خلصت اللعبة، الشخصية كانت: ${figureGames[from].answer}`,
          });
          delete figureGames[from];
        } else if (blankGames[from]) {
          await sock.sendMessage(from, {
            text: `🏳️ خلصت اللعبة، الكلمة كانت: ${blankGames[from].answer}`,
          });
          delete blankGames[from];
        } else if (categoryGames[from]) {
          await sock.sendMessage(from, {
            text: `🏳️ خلصت اللعبة (${categoryGames[from].category} بحرف ${categoryGames[from].letter})`,
          });
          delete categoryGames[from];
        } else if (duels[from] && (sender === duels[from].p1 || sender === duels[from].p2)) {
          const duel = duels[from];
          const winnerJid = sender === duel.p1 ? duel.p2 : duel.p1;
          delete duels[from];
          const newTotal = addPoints(winnerJid, 15);
          await sock.sendMessage(from, {
            text: `🏳️ @${sender.split('@')[0]} استسلم من المبارزة!\n🏆 الفوز لـ @${winnerJid.split('@')[0]} (+15 نقطة، المجموع: ${newTotal})`,
            mentions: [sender, winnerJid],
          });
        } else if (xoGames[from] && (pointsKey(sender) === pointsKey(xoGames[from].p1) || pointsKey(sender) === pointsKey(xoGames[from].p2))) {
          const game = xoGames[from];
          const winnerJid = pointsKey(sender) === pointsKey(game.p1) ? game.p2 : game.p1;
          delete xoGames[from];
          const newTotal = addPoints(winnerJid, 15);
          await sock.sendMessage(from, {
            text: `🏳️ @${sender.split('@')[0]} استسلم من لعبة اكس أو!\n🏆 الفوز لـ @${winnerJid.split('@')[0]} (+15 نقطة، المجموع: ${newTotal})`,
            mentions: [sender, winnerJid],
          });
        } else if (isGroup && wars[from] && wars[from].participants[pointsKey(sender)]) {
          const war = wars[from];
          const myKey = pointsKey(sender);
          war.participants[myKey].hp = 0;
          await sock.sendMessage(from, { text: `🏳️ @${sender.split('@')[0]} استسلم من الحرب وخرج منها.`, mentions: [sender] });
          const alive = Object.values(war.participants).filter((p) => p.hp > 0);
          if (war.phase === 'active' && alive.length <= 1) {
            delete wars[from];
            if (alive.length === 1) {
              const winnerJid = alive[0].jid;
              const totalParticipants = Object.keys(war.participants).length;
              const prize = Math.max(50, totalParticipants * 20);
              const newTotal = addPoints(winnerJid, prize);
              await sock.sendMessage(from, {
                text: `🏆👑 ✦ *انتهت الحرب الجماعية!* ✦ 👑🏆\n\nالفائز الأخير: @${winnerJid.split('@')[0]} 💀⚔️\n\n🎁 +${prize} نقطة (المجموع: ${newTotal})`,
                mentions: [winnerJid],
              });
            }
          }
        } else {
          await sock.sendMessage(from, { text: '⚠️ ما في لعبة شغالة حالياً.' });
        }
        await continueEventIfActive(sock, from);
      }

      // ==== 🎲 عملة ونرد ====
      else if (command === '.عملة') {
        const result = Math.random() < 0.5 ? 'صورة 🪙' : 'كتابة 🪙';
        await sock.sendMessage(from, { text: `🎲 ✦ *نتيجة رمي العملة* ✦\n\n${result}` });
      } else if (command === '.نرد') {
        const roll = Math.floor(Math.random() * 6) + 1;
        await sock.sendMessage(from, { text: `🎲 ✦ *نتيجة النرد* ✦\n\nطلع رقم: *${roll}*` });
      }

      // ==== 💬 اقتباس عشوائي ====
      else if (command === '.اقتباس') {
        const quote = quotes[Math.floor(Math.random() * quotes.length)];
        await sock.sendMessage(from, { text: `💬 ✦ *اقتباس اليوم* ✦\n\n"${quote}"` });
      }

      // ==== 🌤 الطقس ====
      else if (command === '.الطقس') {
        const city = args.join(' ');
        if (!city) {
          await sock.sendMessage(from, { text: '⚠️ اكتب اسم المدينة، مثال: .الطقس الجزائر' });
          return;
        }
        try {
          const { stdout } = await execPromise(
            `curl -s "wttr.in/${encodeURIComponent(city)}?format=%C+|+%t+|+رطوبة:%h+|+رياح:%w" -m 10`
          );
          await sock.sendMessage(from, {
            text: `🌤 ✦ *طقس ${city}* ✦\n\n${stdout.trim()}`,
          });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ ما قدرت أجيب حالة الطقس، جرب اسم مدينة مختلف.' });
        }
      }

      // ==== 💱 تحويل عملات حقيقي بأسعار محدثة (API مجاني، بدون مفتاح) ====
      else if (command === '.تحويل_عملة') {
        // الصيغة: .تحويل_عملة <المبلغ> <من> <الى>  — مثال: .تحويل_عملة 100 USD SAR
        const amount = parseFloat(args[0]);
        const fromCur = (args[1] || '').toUpperCase();
        const toCur = (args[2] || '').toUpperCase();
        if (isNaN(amount) || !fromCur || !toCur) {
          await sock.sendMessage(from, {
            text: '⚠️ الصيغة: .تحويل_عملة <المبلغ> <من> <الى>\nمثال: .تحويل_عملة 100 USD SAR\n\nرموز شائعة: USD, SAR, EGP, AED, EUR, GBP, KWD, DZD, MAD',
          });
          return;
        }
        try {
          const { stdout } = await execPromise(`curl -s "https://open.er-api.com/v6/latest/${fromCur}" -m 10`);
          const data = JSON.parse(stdout);
          if (data.result !== 'success' || !data.rates || !data.rates[toCur]) {
            await sock.sendMessage(from, { text: '❌ ما لقيت رمز العملة. تأكد إنك كاتب الرمز الصحيح (مثال: USD، SAR، EGP).' });
            return;
          }
          const converted = (amount * data.rates[toCur]).toFixed(2);
          await sock.sendMessage(from, {
            text: `💱 ✦ *تحويل عملة* ✦\n\n${amount} ${fromCur} = *${converted} ${toCur}*\n\n📅 آخر تحديث: ${data.time_last_update_utc || 'غير معروف'}`,
          });
        } catch (e) {
          console.log('❌ خطأ بأمر .تحويل_عملة:', e.message);
          await sock.sendMessage(from, { text: '❌ ما قدرت أجيب سعر الصرف حالياً، جرب مرة ثانية بعد شوي.' });
        }
      }

      // ==== 📖 بحث سريع بويكيبيديا (ملخص فوري بدون AI، مفيد للمعلومات الموثوقة) ====
      else if (command === '.بحث') {
        const query = args.join(' ');
        if (!query) {
          await sock.sendMessage(from, { text: '⚠️ اكتب اللي بدك تبحث عنه، مثال: .بحث نيوتن' });
          return;
        }
        try {
          const { stdout } = await execPromise(
            `curl -s "https://ar.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query.replace(/ /g, '_'))}" -m 10`
          );
          const data = JSON.parse(stdout);
          if (data.type === 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found' || !data.extract) {
            await sock.sendMessage(from, {
              text: `❌ ما لقيت نتيجة مباشرة لـ "${query}". جرب صياغة مختلفة، أو استخدم .اسأل للذكاء الاصطناعي.`,
            });
            return;
          }
          await sock.sendMessage(from, {
            text: `📖 ✦ *${data.title}* ✦\n\n${data.extract}\n\n🔗 ${data.content_urls?.desktop?.page || ''}`,
          });
        } catch (e) {
          console.log('❌ خطأ بأمر .بحث:', e.message);
          await sock.sendMessage(from, { text: '❌ صار خطأ أثناء البحث، جرب مرة ثانية.' });
        }
      }

      // ==== 🌙 تحويل التاريخ الميلادي لهجري (أو العكس)، مفيد لمواعيد وأذكار ====
      else if (command === '.تاريخ_هجري') {
        // الصيغة: .تاريخ_هجري (بدون شي = اليوم) أو .تاريخ_هجري DD-MM-YYYY
        const dateArg = args[0];
        try {
          const now = new Date();
          const dd = dateArg ? dateArg.split('-')[0] : String(now.getDate()).padStart(2, '0');
          const mm = dateArg ? dateArg.split('-')[1] : String(now.getMonth() + 1).padStart(2, '0');
          const yyyy = dateArg ? dateArg.split('-')[2] : now.getFullYear();
          const { stdout } = await execPromise(`curl -s "https://api.aladhan.com/v1/gToH/${dd}-${mm}-${yyyy}" -m 10`);
          const data = JSON.parse(stdout);
          if (!data.data || !data.data.hijri) {
            await sock.sendMessage(from, { text: '⚠️ الصيغة: .تاريخ_هجري أو .تاريخ_هجري DD-MM-YYYY\nمثال: .تاريخ_هجري 15-03-2026' });
            return;
          }
          const h = data.data.hijri;
          const g = data.data.gregorian;
          await sock.sendMessage(from, {
            text: `🌙 ✦ *تحويل التاريخ* ✦\n\n📅 ميلادي: ${g.date} (${g.weekday.ar})\n🌙 هجري: ${h.day} ${h.month.ar} ${h.year}هـ`,
          });
        } catch (e) {
          console.log('❌ خطأ بأمر .تاريخ_هجري:', e.message);
          await sock.sendMessage(from, { text: '❌ ما قدرت أجيب التاريخ الهجري حالياً، جرب مرة ثانية.' });
        }
      }

      // ==== 🤖 دردشة مع الذكاء الاصطناعي (Gemini، وGroq احتياطي تلقائي لو وقع) ====
      else if (command === '.اسأل' || command === '.ai') {
        const question = args.join(' ');
        if (!question) {
          await sock.sendMessage(from, { text: '⚠️ اكتب سؤالك بعد الأمر، مثال: .اسأل ليش السما زرقاء؟' });
          return;
        }

        // ==== ⏱️ تبريد: يمنع شخص واحد من إغراق الـ API بأسئلة متلاحقة ====
        const waitSeconds = checkAiCooldown(sender);
        if (waitSeconds > 0 && !isBotOwner(sender)) {
          await sock.sendMessage(from, { text: `⏳ استنى شوي! في تبريد ${waitSeconds} ثانية بين كل سؤال والتاني.` });
          return;
        }

        try {
          await sock.sendPresenceUpdate('composing', from); // ✍️ مؤشر "عم يكتب" حتى المستخدم يعرف إنه البوت شغال عالرد
          const userNumber = resolveOwnerNumber(sender);
          const quotedText =
            msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
            msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text ||
            null;
          const prompt = buildAiPrompt(userNumber, question, quotedText, msg.pushName || null);
          const answer = await askGemini(prompt);
          rememberAiTurn(userNumber, question, answer);
          await sock.sendMessage(from, {
            text: `🤖 ✦ *الذكاء الاصطناعي* ✦\n\n${answer}\n\n_✦ باتذكر آخر أسئلتك بهالمحادثة، اكتب .مسح_الذاكرة لو بدك أبلش من جديد ✦_`,
          });
        } catch (err) {
          console.log('❌ خطأ بأمر .اسأل:', err.message);
          await sock.sendMessage(from, { text: `❌ صار خطأ أثناء التواصل مع الذكاء الاصطناعي.\n📋 السبب: ${err.message}` });
        }
      }

      // ==== 🤖 أمر .كلود: نفس محرك الذكاء الاصطناعي (Gemini/Groq)، بس باسم مختلف — الرد ما بيدّعي هوية Claude/Anthropic ====
      else if (command === '.كلود') {
        const question = args.join(' ');
        if (!question) {
          await sock.sendMessage(from, { text: '⚠️ اكتب سؤالك بعد الأمر، مثال: .كلود ليش السما زرقاء؟' });
          return;
        }

        const waitSeconds = checkAiCooldown(sender);
        if (waitSeconds > 0 && !isBotOwner(sender)) {
          await sock.sendMessage(from, { text: `⏳ استنى شوي! في تبريد ${waitSeconds} ثانية بين كل سؤال والتاني.` });
          return;
        }

        try {
          await sock.sendPresenceUpdate('composing', from);
          const userNumber = resolveOwnerNumber(sender);
          const quotedText =
            msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
            msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text ||
            null;
          const prompt = buildAiPrompt(userNumber, question, quotedText, msg.pushName || null);
          const answer = await askGemini(prompt);
          rememberAiTurn(userNumber, question, answer);
          await sock.sendMessage(from, { text: `✨ ✦ *الرد:* ✦\n\n${answer}` });
        } catch (err) {
          console.log('❌ خطأ بأمر .كلود:', err.message);
          await sock.sendMessage(from, { text: `❌ صار خطأ أثناء التواصل مع الذكاء الاصطناعي.\n📋 السبب: ${err.message}` });
        }
      }

      // ==== 🧹 مسح ذاكرة محادثة الذكاء الاصطناعي الخاصة بيك ====
      else if (command === '.مسح_الذاكرة') {
        const userNumber = resolveOwnerNumber(sender);
        delete aiMemory[userNumber];
        saveJSON(AI_MEMORY_FILE, aiMemory);
        await sock.sendMessage(from, { text: '🧹 ✦ *تم مسح ذاكرة محادثتك مع الذكاء الاصطناعي.* ✦ بلش من جديد!' });
      }

      // ==== 📊 تشوف رصيدك المتبقي من كوتا أوامر الذكاء الاصطناعي اليومية ====
      else if (command === '.كوتتي') {
        if (isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '👑 إنت مالك البوت، ماعندك أي حد لأوامر الذكاء الاصطناعي.' });
          return;
        }
        const key = pointsKey(sender);
        const today = new Date().toISOString().slice(0, 10);
        const entry = getShopEntry(sender);
        const limit = isPremiumActive(entry) ? DAILY_AI_LIMIT_VIP : DAILY_AI_LIMIT_REGULAR;
        const usedToday = (aiUsage[key] && aiUsage[key].date === today) ? aiUsage[key].count : 0;
        const remaining = Math.max(0, limit - usedToday);

        await sock.sendMessage(from, {
          text: buildFancyCard(
            '📊',
            'كوتة الذكاء الاصطناعي اليومية',
            `✅ استخدمت: *${usedToday}* / ${limit}\n🔋 المتبقي: *${remaining}*`,
            `${isPremiumActive(entry) ? '💠 عندك حد VIP أعلى (بريميوم مفعّل).' : '💠 اشترك VIP من .المتجر لحد يومي أعلى (120 بدل 40).'}\n🔄 الكوتا بتصفّر تلقائياً كل يوم.`
          ),
        });
      }

      // ==== 👑 المالك يصفّر كوتا شخص معيّن يدوياً (لو علق بسبب استخدام زايد ومحتاج استثناء) ====
      else if (command === '.تصفير_كوتا') {
        if (!isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر حصراً لمالك البوت.*' });
          return;
        }
        const targetJid = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (!targetJid) {
          await sock.sendMessage(from, { text: '⚠️ منشن الشخص يلي بدك تصفّر كوتته، مثال: .تصفير_كوتا @شخص' });
          return;
        }
        const key = pointsKey(targetJid);
        delete aiUsage[key];
        saveAiUsage();
        await sock.sendMessage(from, {
          text: `✅ تم تصفير كوتا الذكاء الاصطناعي اليومية لـ @${key}`,
          mentions: [targetJid],
        });
      }

      // ==== 🔎 بحث ذكي بالنت: يجيب خلاصة سريعة (DuckDuckGo) وبعدين يخلي الذكاء الاصطناعي يصيغها كجواب طبيعي بالعربي ====
      // (مختلف عن .بحث اللي بيجيب ملخص ويكيبيديا مباشر بدون AI — هاد بيغطي أسئلة أوسع وبيصيغ الجواب بأسلوب طبيعي)
      else if (command === '.بحث_ذكي') {
        const query = args.join(' ');
        if (!query) {
          await sock.sendMessage(from, { text: '⚠️ اكتب شو بدك تبحث عنه بعد الأمر، مثال: .بحث_ذكي عاصمة اليابان' });
          return;
        }

        const waitSeconds = checkAiCooldown(sender);
        if (waitSeconds > 0 && !isBotOwner(sender)) {
          await sock.sendMessage(from, { text: `⏳ استنى شوي! في تبريد ${waitSeconds} ثانية بين كل سؤال والتاني.` });
          return;
        }

        try {
          await sock.sendPresenceUpdate('composing', from);
          let raw = '';
          try {
            raw = await webSearchSummary(query);
          } catch (searchErr) {
            console.log('⚠️ خطأ بأداة البحث السريع (منكمل بمعرفة Gemini العامة):', searchErr.message);
          }

          let answer;
          if (raw && raw.trim()) {
            const prompt =
              `بناءً على نتائج البحث التالية من الإنترنت، جاوب على سؤال المستخدم بالعربي وبأسلوب طبيعي مختصر ` +
              `(مو نسخ ولصق، صغ الجواب بأسلوبك). لو النتائج ناقصة أو مش متعلقة بالسؤال، قول هيك بصراحة.\n\n` +
              `سؤال المستخدم: ${query}\n\n=== نتائج البحث ===\n${raw.slice(0, 3000)}`;
            answer = await askGemini(prompt);
          } else {
            const prompt =
              `مافي نتيجة بحث مباشرة لهاد السؤال. جاوب عليه بالعربي بناءً على معرفتك العامة، ` +
              `ونبّه بوضوح إنه المعلومة ممكن تكون قديمة أو غير مؤكدة 100% لأنك ما قدرت تتحقق منها بالنت: ${query}`;
            answer = await askGemini(prompt);
          }

          await sock.sendMessage(from, { text: `🔎 ✦ *نتيجة البحث الذكي* ✦\n\n${answer}` });
        } catch (err) {
          console.log('❌ خطأ بأمر .بحث_ذكي:', err.message);
          await sock.sendMessage(from, { text: `❌ صار خطأ أثناء البحث.\n📋 السبب: ${err.message}` });
        }
      }

      // ==== 📚 تعليم البوت سؤال وجواب ثابت (المالك بس) — الصيغة: .تعليم سؤال | جواب ====
      else if (command === '.تعليم') {
        if (!isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '⛔ هاد الأمر لمالك البوت بس.' });
          return;
        }
        const raw = args.join(' ');
        const parts = raw.split('|');
        if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
          await sock.sendMessage(from, {
            text: '⚠️ الصيغة: .تعليم السؤال | الجواب\nمثال: .تعليم شو اسمك | أنا البوت الخاص بمجموعتنا 🤖',
          });
          return;
        }
        const q = parts[0].trim();
        const a = parts[1].trim();

        // لو نفس السؤال (أو قريب منه كتير) موجود أصلاً، نحدّث جوابه بدل ما نكرره
        const existingIndex = customKnowledge.findIndex((e) => normalizeArabicText(e.q) === normalizeArabicText(q));
        if (existingIndex !== -1) {
          customKnowledge[existingIndex].a = a;
          saveKnowledge();
          await sock.sendMessage(from, { text: `♻️ ✦ *تم تحديث الجواب* ✦\n❓ ${q}\n💬 ${a}` });
        } else {
          customKnowledge.push({ q, a });
          saveKnowledge();
          await sock.sendMessage(from, {
            text: `✅ ✦ *تم التعليم* ✦\n❓ ${q}\n💬 ${a}\n\n📊 مجموع المعلومات: ${customKnowledge.length}`,
          });
        }
      }

      // ==== 🗑️ نسيان سؤال محفوظ برقمه (المالك بس) ====
      else if (command === '.نسيان') {
        if (!isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '⛔ هاد الأمر لمالك البوت بس.' });
          return;
        }
        const index = parseInt(args[0], 10) - 1;
        if (isNaN(index) || index < 0 || index >= customKnowledge.length) {
          await sock.sendMessage(from, { text: '⚠️ رقم غير صحيح. اكتب .معرفتي حتى تشوف الأرقام الصحيحة.' });
          return;
        }
        const removed = customKnowledge.splice(index, 1)[0];
        saveKnowledge();
        await sock.sendMessage(from, { text: `🗑️ ✦ *تم النسيان* ✦\n❓ ${removed.q}` });
      }

      // ==== 📋 عرض كل المعلومات المخزّنة ====
      else if (command === '.معرفتي') {
        if (customKnowledge.length === 0) {
          await sock.sendMessage(from, {
            text: '📭 ما في معلومات محفوظة لسا. المالك يقدر يضيف بأمر:\n.تعليم السؤال | الجواب',
          });
          return;
        }
        const list = customKnowledge.map((e, i) => `${i + 1}. ❓ ${e.q}`).join('\n');
        await sock.sendMessage(from, {
          text: `📚 ✦ *معلوماتي المحفوظة (${customKnowledge.length})* ✦\n\n${list}\n\n💬 اسأل عن أي وحدة بأمر .بوتي`,
        });
      }

      // ==== 🤖 "الذكاء الاصطناعي الخاص فيك": بيرد من المعلومات المحفوظة بس، مش ذكاء مفتوح ====
      else if (command === '.بوتي') {
        const question = args.join(' ').trim();
        if (!question) {
          await sock.sendMessage(from, { text: '⚠️ اكتب سؤالك بعد الأمر، مثال: .بوتي شو اسمك' });
          return;
        }
        if (customKnowledge.length === 0) {
          await sock.sendMessage(from, {
            text: '📭 ما في معلومات محفوظة لسا. المالك يقدر يضيف بأمر:\n.تعليم السؤال | الجواب',
          });
          return;
        }
        const match = findKnowledgeAnswer(question);
        if (!match) {
          await sock.sendMessage(from, {
            text: `🤷 ما عندي جواب على هيك سؤال. اكتب .معرفتي حتى تشوف شو بقدر أجاوب عليه.`,
          });
          return;
        }
        await sock.sendMessage(from, { text: `🤖 ✦ *${match.q}* ✦\n\n${match.a}` });
      }

      // ==== 🖼️ تحليل صورة بالذكاء الاصطناعي: رد على صورة بهالأمر (أو زوّده وصف) وبيوصفلك/يحللها ====
      else if (command === '.حلل_صورة' || command === '.تحليل_صورة') {
        try {
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const imageMsg = msg.message?.imageMessage || quoted?.imageMessage;
          if (!imageMsg) {
            await sock.sendMessage(from, {
              text: '⚠️ ابعت صورة واكتب .حلل_صورة بالكابشن، أو رد على صورة بهالأمر.',
            });
            return;
          }

          const waitSeconds = checkAiCooldown(sender);
          if (waitSeconds > 0 && !isBotOwner(sender)) {
            await sock.sendMessage(from, { text: `⏳ استنى شوي! في تبريد ${waitSeconds} ثانية.` });
            return;
          }

          await sock.sendMessage(from, { text: '🔍 عم أحلل الصورة، ثانية...' });
          await sock.sendPresenceUpdate('composing', from);

          const stream = await downloadContentFromMessage(imageMsg, 'image');
          let buffer = Buffer.from([]);
          for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
          }
          const base64Image = buffer.toString('base64');
          const userQuestion = args.join(' ') || 'وصف هاي الصورة بالتفصيل وقول شو فيها بالعربي';

          const answer = await askGemini(userQuestion, base64Image, imageMsg.mimetype || 'image/jpeg');

          await sock.sendMessage(from, { text: `🖼️ ✦ *تحليل الصورة* ✦\n\n${answer}` });
        } catch (err) {
          console.log('❌ خطأ بأمر .حلل_صورة:', err.message);
          await sock.sendMessage(from, { text: `❌ ما قدرت أحلل الصورة.\n📋 السبب: ${err.message}` });
        }
      }

      // ==== 🎙️ تحدث صوتي مع الذكاء الاصطناعي: رد على ملاحظة صوتية بهاد الأمر ====
      else if (command === '.تحدث' || command === '.رد_صوتي') {
        try {
          const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
          const audioMsg = quoted?.audioMessage;

          if (!audioMsg) {
            await sock.sendMessage(from, { text: '⚠️ رد على ملاحظة صوتية بهاد الأمر (.تحدث) حتى أسمعها وأرد عليك.' });
            return;
          }

          const waitSeconds = checkAiCooldown(sender);
          if (waitSeconds > 0 && !isBotOwner(sender)) {
            await sock.sendMessage(from, { text: `⏳ استنى شوي! في تبريد ${waitSeconds} ثانية.` });
            return;
          }

          await sock.sendMessage(from, { text: '🎙️ عم أسمع الملاحظة الصوتية، ثانية...' });

          const stream = await downloadContentFromMessage(audioMsg, 'audio');
          let buffer = Buffer.from([]);
          for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
          const base64Audio = buffer.toString('base64');

          const answer = await askGeminiAudio(base64Audio, audioMsg.mimetype || 'audio/ogg; codecs=opus');

          await sock.sendMessage(from, { text: `🎙️ ✦ *رد الذكاء الاصطناعي* ✦\n\n${answer}` });

          // ==== نحاول كمان نرجعله رد صوتي فوق الرد النصي (لو TTS متوفر) ====
          try {
            const voiceReply = await textToSpeechFile(answer);
            if (voiceReply) {
              await sock.sendMessage(from, {
                audio: fs.readFileSync(voiceReply),
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true,
              });
              fs.unlinkSync(voiceReply);
            }
          } catch (ttsErr) {
            console.log('⚠️ ما قدرت أحول الرد لصوت:', ttsErr.message);
          }
        } catch (err) {
          console.log('❌ خطأ بأمر .تحدث:', err.message);
          await sock.sendMessage(from, {
            text: `❌ ما قدرت أسمع أو أفهم الملاحظة الصوتية.\n📋 السبب: ${err.message}\n\nجرب مرة تانية أو أرسل ملاحظة أوضح.`,
          });
        }
      }

      // ==== 📋 قائمة كل الأصوات المتاحة، مع طريقة استخدامها ====
      else if (command === '.اصوات' || command === '.الاصوات') {
        const maleList = Object.entries(TTS_VOICES).filter(([, v]) => v.gender === 'm');
        const femaleList = Object.entries(TTS_VOICES).filter(([, v]) => v.gender === 'f');
        const lineFor = ([key, v]) => `   ▸ *${key}* — ${v.label}`;
        await sock.sendMessage(from, {
          text:
            `╭─❍───────────────❍─╮\n` +
            `   🎙️ *أصوات الذكاء الاصطناعي* 🎙️\n` +
            `╰─❍───────────────❍─╯\n\n` +
            `🧔 *أصوات رجالية:*\n${maleList.map(lineFor).join('\n')}\n\n` +
            `👩 *أصوات نسائية:*\n${femaleList.map(lineFor).join('\n')}\n\n` +
            `✨ *طريقة الاستخدام:*\n` +
            `.نطق <اسم_الصوت> <النص>\n` +
            `مثال: .نطق مصريه أهلاً بيك يا قمر\n\n` +
            `💡 لو ما اخترتش صوت، بيستخدم الصوت الافتراضي (${TTS_VOICES[DEFAULT_TTS_VOICE_KEY].label})`,
        });
      }

      // ==== 🔊 تحويل أي نص لملاحظة صوتية — تقدر تختار الصوت أول كلمة، مثال: .نطق مصريه النص هنا ====
      else if (command === '.نطق' || command === '.صوت') {
        let voiceKey = DEFAULT_TTS_VOICE_KEY;
        let textArgs = args;

        // ==== لو أول كلمة بعد الأمر هي اسم صوت معروف، نستخدمه ونشيله من النص ====
        if (args.length > 0 && TTS_VOICES[args[0]]) {
          voiceKey = args[0];
          textArgs = args.slice(1);
        }

        const text2speak = textArgs.join(' ');
        if (!text2speak) {
          await sock.sendMessage(from, {
            text:
              '⚠️ اكتب النص بعد الأمر، مثال: .نطق أهلاً وسهلاً فيكم\n' +
              '🎙️ أو اختار صوت: .نطق مصريه أهلاً وسهلاً فيكم\n' +
              '📋 شوف كل الأصوات: .اصوات',
          });
          return;
        }
        if (text2speak.length > 500) {
          await sock.sendMessage(from, { text: '⚠️ النص طويل كتير، خليه أقل من 500 حرف.' });
          return;
        }

        try {
          await sock.sendMessage(from, {
            text: `🔊 جاري تحويل النص لصوت (${TTS_VOICES[voiceKey].label})...`,
          });
          const voiceFile = await textToSpeechFile(text2speak, voiceKey);
          if (!voiceFile) {
            await sock.sendMessage(from, {
              text: '❌ ما قدرت أحول النص لصوت. تأكد إن أداة edge-tts متثبتة (pip install edge-tts).',
            });
            return;
          }
          await sock.sendMessage(from, {
            audio: fs.readFileSync(voiceFile),
            mimetype: 'audio/ogg; codecs=opus',
            ptt: true,
          });
          fs.unlinkSync(voiceFile);
        } catch (err) {
          console.log('❌ خطأ بأمر .نطق:', err.message);
          await sock.sendMessage(from, { text: '❌ صار خطأ أثناء تحويل النص لصوت.' });
        }
      }

      // ==== 🎮 آي بي سيرفر الماينكرافت ====
      else if (command === '.ip') {
        await sock.sendMessage(from, {
          text:
            '🎮 ✦ *معلومات سيرفر MedooSMP* ✦\n\n' +
            '☕ *Java:* MedooSMP.aternos.me\n' +
            '📱 *Bedrock:* MedooSMP.aternos.me:27310\n\n' +
            'شوفونا هناك! 🕹️',
        });
      }

      // ==== 🌍 ترجمة نص (ذكاء اصطناعي) ====
      else if (command === '.ترجم') {
        const content = args.join(' ');
        if (!content) {
          await sock.sendMessage(from, { text: '⚠️ اكتب النص بعد الأمر، مثال: .ترجم Good morning' });
          return;
        }
        try {
          const answer = await askGemini(
            `ترجم النص التالي، وحدد اللغة تلقائياً (لو عربي ترجمه لإنجليزي، ولو إنجليزي أو غيره ترجمه لعربي). رد بالترجمة بس بدون أي شرح إضافي:\n\n${content}`
          );
          await sock.sendMessage(from, { text: `🌍 ✦ *الترجمة* ✦\n\n${answer}` });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ ما قدرت أترجم، جرب مرة تانية.' });
        }
      }

      // ==== 📝 تلخيص نص (ذكاء اصطناعي) ====
      else if (command === '.لخص') {
        const content = args.join(' ');
        if (!content) {
          await sock.sendMessage(from, { text: '⚠️ اكتب النص بعد الأمر، مثال: .لخص [نص طويل]' });
          return;
        }
        try {
          const answer = await askGemini(`لخص النص التالي بجملتين أو ثلاثة بالعربي، بدون مقدمات:\n\n${content}`);
          await sock.sendMessage(from, { text: `📝 ✦ *التلخيص* ✦\n\n${answer}` });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ ما قدرت ألخص النص، جرب مرة تانية.' });
        }
      }

      // ==== ✍️ تصحيح إملائي ولغوي (ذكاء اصطناعي) ====
      else if (command === '.صحح') {
        const content = args.join(' ');
        if (!content) {
          await sock.sendMessage(from, { text: '⚠️ اكتب الجملة بعد الأمر، مثال: .صحح [جملة فيها اخطاء]' });
          return;
        }
        try {
          const answer = await askGemini(
            `صحح الأخطاء الإملائية واللغوية بالجملة التالية، ورد بالجملة المصححة بس بدون شرح:\n\n${content}`
          );
          await sock.sendMessage(from, { text: `✍️ ✦ *النص المصحح* ✦\n\n${answer}` });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ ما قدرت أصحح النص، جرب مرة تانية.' });
        }
      }

      // ==== 💻 توليد كود برمجي (ذكاء اصطناعي) ====
      else if (command === '.اكتب_كود' || command === '.كود') {
        const content = args.join(' ');
        if (!content) {
          await sock.sendMessage(from, { text: '⚠️ اشرح شو بدك بالكود، مثال: .اكتب_كود دالة بايثون تحسب مجموع مصفوفة' });
          return;
        }
        const waitSeconds = checkAiCooldown(sender);
        if (waitSeconds > 0 && !isBotOwner(sender)) {
          await sock.sendMessage(from, { text: `⏳ استنى شوي! في تبريد ${waitSeconds} ثانية.` });
          return;
        }
        try {
          const answer = await askGemini(
            'اكتب كود برمجي يلبي الطلب التالي. رد بالكود جوا كتلة كود (Markdown code block)، مع تعليقات قصيرة بالعربي توضح الأجزاء المهمة، وشرح مختصر جداً بعد الكود (سطرين كحد أقصى):\n\n' + content
          );
          await sock.sendMessage(from, { text: `💻 ✦ *الكود* ✦\n\n${answer}` });
        } catch (e) {
          console.log('❌ خطأ بأمر .اكتب_كود:', e.message);
          await sock.sendMessage(from, { text: '❌ ما قدرت أولّد الكود، جرب مرة تانية.' });
        }
      }

      // ==== 📄 تحليل ملف نصي مرفق (ذكاء اصطناعي) — رد على مستند (txt/أي نص) بهالأمر وبيلخصلك/يجاوب عن سؤالك فيه ====
      else if (command === '.حلل_ملف') {
        try {
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const docMsg = msg.message?.documentMessage || quoted?.documentMessage;
          if (!docMsg) {
            await sock.sendMessage(from, { text: '⚠️ رد على ملف نصي (txt أو مشابه) بهالأمر، وممكن تضيف سؤال معين بعد الأمر.' });
            return;
          }

          const waitSeconds = checkAiCooldown(sender);
          if (waitSeconds > 0 && !isBotOwner(sender)) {
            await sock.sendMessage(from, { text: `⏳ استنى شوي! في تبريد ${waitSeconds} ثانية.` });
            return;
          }

          const mimetype = docMsg.mimetype || '';
          const isTextLike = mimetype.startsWith('text/') || mimetype === 'application/json' || /\.(txt|md|csv|json|log)$/i.test(docMsg.fileName || '');
          if (!isTextLike) {
            await sock.sendMessage(from, { text: '⚠️ حالياً بدعم بس الملفات النصية (txt, md, csv, json, log). لو بدك تحليل صور استخدم .حلل_صورة.' });
            return;
          }

          await sock.sendMessage(from, { text: '📄 عم أقرأ الملف، ثانية...' });

          const stream = await downloadContentFromMessage(docMsg, 'document');
          let buffer = Buffer.from([]);
          for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
          }
          let content = buffer.toString('utf8');
          if (content.length > 15000) content = content.slice(0, 15000) + '\n...[تم اقتصاص الملف لأنه طويل]';

          const userQuestion = args.join(' ') || 'لخص هاد الملف وأهم النقاط فيه بالعربي';
          const answer = await askGemini(`${userQuestion}\n\n=== محتوى الملف ===\n${content}`);

          await sock.sendMessage(from, { text: `📄 ✦ *تحليل الملف* ✦\n\n${answer}` });
        } catch (err) {
          console.log('❌ خطأ بأمر .حلل_ملف:', err.message);
          await sock.sendMessage(from, { text: '❌ ما قدرت أحلل الملف، جرب مرة تانية.' });
        }
      }

      // ==== 🧮 حاسبة تعابير رياضية ====
      else if (command === '.حاسبة') {
        const expr = args.join(' ');
        if (!expr) {
          await sock.sendMessage(from, { text: '⚠️ اكتب العملية الحسابية، مثال: .حاسبة (5+3)*2' });
          return;
        }
        // نسمح بالأرقام والعمليات الأساسية بس، أي شي تاني نرفضه لأسباب أمان
        if (!/^[0-9+\-*/().\s%]+$/.test(expr)) {
          await sock.sendMessage(from, { text: '⚠️ اكتب عملية حسابية صحيحة (أرقام وعمليات بس).' });
          return;
        }
        try {
          const result = Function(`"use strict"; return (${expr})`)();
          await sock.sendMessage(from, { text: `🧮 ✦ *النتيجة* ✦\n\n${expr} = *${result}*` });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ العملية الحسابية غير صحيحة.' });
        }
      }

      // ==== 📱 توليد رمز QR ====
      else if (command === '.qr') {
        const content = args.join(' ');
        if (!content) {
          await sock.sendMessage(from, { text: '⚠️ اكتب النص أو الرابط بعد الأمر، مثال: .qr https://example.com' });
          return;
        }
        try {
          const url = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(content)}`;
          const filePath = `/tmp/qr_${Date.now()}.png`;
          await execPromise(`curl -s -o "${filePath}" "${url}" --max-time 20`);
          await sock.sendMessage(from, { image: fs.readFileSync(filePath), caption: '📱 ✦ *رمز QR جاهز* ✦' });
          fs.unlinkSync(filePath);
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ ما قدرت أولّد رمز QR، جرب مرة تانية.' });
        }
      }

      // ==== 🔗 اختصار رابط ====
      else if (command === '.اختصار_رابط') {
        const link = args[0];
        if (!link || !/^https?:\/\//.test(link)) {
          await sock.sendMessage(from, { text: '⚠️ اكتب رابط صحيح يبدأ بـ http:// أو https://' });
          return;
        }
        try {
          const { stdout } = await execPromise(
            `curl -s "https://tinyurl.com/api-create.php?url=${encodeURIComponent(link)}" --max-time 15`
          );
          const shortened = stdout.trim();
          if (!shortened.startsWith('http')) throw new Error('رد غير متوقع');
          await sock.sendMessage(from, { text: `🔗 ✦ *الرابط المختصر* ✦\n\n${shortened}` });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ ما قدرت أختصر الرابط، جرب مرة تانية.' });
        }
      }

      // ==== 🏃 سباق الكتابة السريعة ====
      else if (command === '.سباق') {
        const word = speedWordsHard[Math.floor(Math.random() * speedWordsHard.length)];
        speedGames[from] = { word };
        await sock.sendMessage(from, {
          text: `🏃 ✦ *سباق الكتابة السريعة* ✦\n\nأول واحد يكتب الكلمة التالية بيفوز:\n\n👉 *${word}*`,
        });
      }

      // ==== 🧮 لعبة الحساب السريع ====
      else if (command === '.حساب') {
        const { num1, num2, op, answer } = generateMathChallenge();
        mathGames[from] = { answer };
        await sock.sendMessage(from, {
          text: `🧮 ✦ *لعبة الحساب السريع* ✦\n\nكم ناتج: ${num1} ${op} ${num2} ؟\n\nاكتب الإجابة مباشرة!`,
        });
      }

      // ==== 🔤 لعبة فك الكلمة ====
      else if (command === '.فك_الكلمة') {
        const word = scrambleWords[Math.floor(Math.random() * scrambleWords.length)];
        const scrambled = shuffleWord(word);
        scrambleGames[from] = { word };
        await sock.sendMessage(from, {
          text: `🔤 ✦ *فك الكلمة* ✦\n\nرتّب هاي الحروف لتكوين كلمة صحيحة:\n\n👉 *${scrambled}*\n\nاكتب الكلمة الصحيحة مباشرة!`,
        });
      }

      // ================================================
      // 🧩 دفعة ألعاب جديدة
      // ================================================

      // ---- 🧩 لغز ----
      else if (command === '.لغز') {
        const r = riddles[Math.floor(Math.random() * riddles.length)];
        riddleGames[from] = { answer: r.a.trim() };
        await sock.sendMessage(from, {
          text: `🧩 ✦ *لغز* ✦\n\n${r.q}\n\nاكتب إجابتك مباشرة! (.استسلم للانسحاب)`,
        });
      }

      // ---- ✅❌ صح أو خطأ ----
      else if (command === '.صح_خطأ') {
        const item = trueFalseStatements[Math.floor(Math.random() * trueFalseStatements.length)];
        trueFalseGames[from] = { answer: item.a };
        await sock.sendMessage(from, {
          text: `✅❌ ✦ *صح أو خطأ* ✦\n\n"${item.s}"\n\nاكتب "صح" أو "خطأ"`,
        });
      }

      // ---- 🚩 تخمين الدولة من العلم ----
      else if (command === '.تخمين_الدولة') {
        const item = flagCountries[Math.floor(Math.random() * flagCountries.length)];
        flagGames[from] = { name: item.name };
        await sock.sendMessage(from, {
          text: `🚩 ✦ *خمن الدولة* ✦\n\n${item.flag}\n\nشو اسم هاي الدولة؟`,
        });
      }

      // ---- 📜 إكمال المثل ----
      else if (command === '.اكمل_مثل') {
        const item = proverbs[Math.floor(Math.random() * proverbs.length)];
        proverbGames[from] = { answer: item.answer.trim() };
        await sock.sendMessage(from, {
          text: `📜 ✦ *إكمال المثل* ✦\n\n"${item.half} ..."\n\nكمّل المثل!`,
        });
      }

      // ---- 🧠 خمن الشخصية ----
      else if (command === '.خمن_شخصية') {
        const item = famousFigures[Math.floor(Math.random() * famousFigures.length)];
        figureGames[from] = { answer: item.a.trim() };
        await sock.sendMessage(from, {
          text: `🧠 ✦ *خمن الشخصية* ✦\n\n${item.clue}\n\nمين هاي الشخصية؟`,
        });
      }

      // ---- ✏️ الكلمة الناقصة ----
      else if (command === '.كلمة_ناقصة') {
        const item = fillBlanks[Math.floor(Math.random() * fillBlanks.length)];
        blankGames[from] = { answer: item.a.trim() };
        await sock.sendMessage(from, {
          text: `✏️ ✦ *الكلمة الناقصة* ✦\n\n${item.sentence}\n\nشو الكلمة الناقصة؟`,
        });
      }

      // ---- 🔠 تصنيف: فئة + حرف ----
      else if (command === '.تصنيف') {
        const category = categories[Math.floor(Math.random() * categories.length)];
        const letter = arabicLetters[Math.floor(Math.random() * arabicLetters.length)];
        categoryGames[from] = { category, letter };
        await sock.sendMessage(from, {
          text: `🔠 ✦ *تحدي التصنيف* ✦\n\nاكتب اسم *${category}* يبدأ بحرف *${letter}*\n\nأول واحد يجاوب صح ياخد النقاط!`,
        });
      }

      // ---- 📋 قائمة الألعاب ----
      else if (command === '.قائمة_الاوامر_الجديدة' || command === '.اوامر_جديدة') {
        await sock.sendMessage(from, {
          text:
            `✨ ✦ *240 أمر جديد بالبوت* ✦ ✨\n\n` +
            `📦 مقسّمين على دفعتين، كل الفئات:\n\n` +
            `💬 اقتباسات وحكم — .اقتباس_حب .اقتباس_نجاح .حكمة_يومية .اقتباس_عمل .حكمة_يابانية وغيرهم كتير\n` +
            `💡 معلومات وحقائق — .معلومة_فضاء .فوائد_ماء .معلومة_جسم_الانسان .هل_تعلم_جغرافي وغيرهم\n` +
            `❤️ عبارات اجتماعية — .صباح_الخير .مجاملة_ذكاء .عبارة_زواج .تهنئة_نجاح وغيرهم\n` +
            `🔮 فأل وشخصية (ترفيهي بحت) — .برجك .حيوانك_الروحي .رقم_شخصيتك .عنصرك وغيرهم\n` +
            `❓ أسئلة وكسر جليد — .لو_خيروك .سؤال_عميق .سؤال_مستقبل .سؤال_تخيل وغيرهم\n` +
            `🧰 أدوات حقيقية شغالة فعلياً — .جذر_تربيعي .base64_تشفير .نظرية_فيثاغورس .مولد_باسورد وغيرهم\n` +
            `🎮 ألعاب سريعة — .احزر_العلم .استنتاج .كرة_السحر .تحدي_الحفظ وغيرهم\n\n` +
            `ℹ️ كل أمر بترسله لحاله بدون شرح زيادة، جربهم كلهم بدون خوف!`,
        });
      }



      else if (command === '.قائمة_الالعاب') {
        await sock.sendMessage(from, {
          text:
            '🎮 ✦ *كل الألعاب المتوفرة* ✦\n\n' +
            '🎯 .تخمين — تخمين رقم بين 1 و100\n' +
            '🧠 .سؤال — أسئلة ثقافية عامة\n' +
            '🧮 .حساب — حساب سريع\n' +
            '🔤 .فك_الكلمة — رتّب حروف كلمة\n' +
            '🧩 .لغز — ألغاز ذكاء\n' +
            '✅❌ .صح_خطأ — معلومة صح ولا غلط\n' +
            '🚩 .تخمين_الدولة — خمن الدولة من علمها\n' +
            '📜 .اكمل_مثل — كمّل المثل الشعبي\n' +
            '🧠 .خمن_شخصية — خمن شخصية من وصفها\n' +
            '✏️ .كلمة_ناقصة — كمّل الجملة الناقصة\n' +
            '🔠 .تصنيف — اكتب كلمة بفئة معينة تبدأ بحرف\n' +
            '🏃 .سباق — أسرع واحد يكتب الكلمة\n' +
            '⚔️ .تحدي — تحدي حجر ورقة مقص\n' +
            '✊ .اختر — اختار حجر/ورقة/مقص\n' +
            '⭕❌ .اكس_او @شخص — لعبة اكس أو (تيك تاك تو)\n' +
            '🎯 اكتب رقم الخانة (1-9) مباشرة، أو .حرك <رقم> — تحط رمزك بلعبة اكس أو\n' +
            '🎯 .مشنقة — خمن حروف كلمة سرية جماعياً (اكتب حرف مباشرة)\n' +
            '🔗 .سلسلة_كلمات — كل كلمة تبلش بآخر حرف من اللي قبلها\n' +
            '⚔️ .مبارزة @شخص — مبارزة نقاط حياة ملحمية\n' +
            '💎 .صراحة — لعبة أسئلة صراحة بالدور (شوف .مساعدة_صراحة)\n' +
            '🪙 .عملة — رمي عملة\n' +
            '🎲 .نرد — رمي نرد\n\n' +
            '🏳️ اكتب .استسلم بأي وقت لإنهاء اللعبة الحالية',
        });
      }

      // ================================================
      // 💎 أوامر لعبة "صراحة"
      // ================================================

      // ---- ℹ️ شرح لعبة الصراحة ----
      else if (command === '.مساعدة_صراحة') {
        await sock.sendMessage(from, {
          text:
            `╭─❍───────────────❍─╮\n` +
            `   💎✨ *دليل لعبة الصراحة* ✨💎\n` +
            `╰─❍───────────────❍─╯\n\n` +
            `💎 .صراحة — يبدأ لوبي لعبة جديدة\n` +
            `🙋 .دخول_صراحة — تنضم للعبة\n` +
            `🚀 .شغل_صراحة — يبدأ الأدوار (لازم لاعبين 2+)\n` +
            `⏭️ .تخطي_صراحة — الأدمن يتخطى دور اللاعب الحالي\n` +
            `🏁 .انهاء_صراحة — صاحب اللعبة أو الأدمن ينهيها\n\n` +
            `📖 *طريقة اللعب:*\n` +
            `1️⃣ حدا يبدأ بـ .صراحة\n` +
            `2️⃣ اللي بدهم يلعبوا يكتبوا .دخول_صراحة\n` +
            `3️⃣ بعد ما ينضم 2 لاعبين ع الأقل، حدا يكتب .شغل_صراحة\n` +
            `4️⃣ البوت بيسأل صاحب الدور سؤال صراحة، وأي رد منه = إجابة (+8 نقاط)\n` +
            `5️⃣ بعد كل إجابة، الدور بينتقل تلقائي للاعب التالي بسؤال جديد\n\n` +
            `📚 بنك الأسئلة عندنا فيه ${sincerityQuestions.length} سؤال متنوع 🔥\n` +
            `🛡️ صلاحيات الأدمن العادية (زي مسح الإنذارات .مسح_الانذارات) بتفضل شغالة زي ما هي، اللعبة ما بتضيف ولا بتشيل أي صلاحية تانية.`,
        });
      }

      // ---- 💎 بدء لوبي لعبة صراحة جديدة ----
      else if (command === '.صراحة') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ لعبة الصراحة تشتغل بالقروبات فقط.' });
          return;
        }
        if (sincerityGames[from]) {
          await sock.sendMessage(from, {
            text: '⚠️ في لعبة صراحة شغالة أصلاً بهاد القروب! اكتب .دخول_صراحة عشان تنضم.',
          });
          return;
        }
        sincerityGames[from] = {
          players: [sender],
          turn: 0,
          used: new Set(),
          active: false,
          hostSender: sender,
        };
        await sock.sendMessage(from, {
          text:
            `╭─❍───────────────❍─╮\n` +
            `   💎✨ *لعبة أسئلة الصراحة* ✨💎\n` +
            `╰─❍───────────────❍─╯\n\n` +
            `👑 بدأها: @${sender.split('@')[0]}\n` +
            `🎯 عدد اللاعبين: 1\n\n` +
            `✨ .دخول_صراحة — للانضمام\n` +
            `🚀 .شغل_صراحة — تبدأ الأدوار (لازم لاعبين 2 ع الأقل)\n\n` +
            `📚 بنك الأسئلة: ${sincerityQuestions.length} سؤال متنوع 🔥\n` +
            `ℹ️ التفاصيل: .مساعدة_صراحة`,
          mentions: [sender],
        });
      }

      // ---- 🙋 الانضمام للوبي الحالي ----
      else if (command === '.دخول_صراحة' || command === '.انضم_صراحة') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ لعبة الصراحة تشتغل بالقروبات فقط.' });
          return;
        }
        const game = sincerityGames[from];
        if (!game) {
          await sock.sendMessage(from, { text: '⚠️ ما في لعبة صراحة شغالة. ابدأ وحدة جديدة بـ .صراحة' });
          return;
        }
        if (game.players.includes(sender)) {
          await sock.sendMessage(from, { text: '✅ انت أصلاً منضم للعبة.' });
          return;
        }
        game.players.push(sender);
        await sock.sendMessage(from, {
          text:
            `🙋 ✦ *انضم لاعب جديد!* ✦\n` +
            `@${sender.split('@')[0]} دخل لعبة الصراحة\n` +
            `🎯 عدد اللاعبين الآن: ${game.players.length}`,
          mentions: [sender],
        });
      }

      // ---- 🚀 بدء الأدوار الفعلية ----
      else if (command === '.شغل_صراحة' || command === '.بدء_صراحة') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ لعبة الصراحة تشتغل بالقروبات فقط.' });
          return;
        }
        const game = sincerityGames[from];
        if (!game) {
          await sock.sendMessage(from, { text: '⚠️ ما في لوبي صراحة مفتوح. ابدأ وحدة بـ .صراحة' });
          return;
        }
        if (game.active) {
          await sock.sendMessage(from, { text: '⚠️ اللعبة شغالة أصلاً!' });
          return;
        }
        if (sender !== game.hostSender && !(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ بس اللي بدأ اللعبة أو أدمن القروب يقدر يشغلها.' });
          return;
        }
        if (game.players.length < 2) {
          await sock.sendMessage(from, {
            text: '⚠️ لازم لاعبين 2 ع الأقل قبل ما تبدأ. استنى ناس تنضم بـ .دخول_صراحة',
          });
          return;
        }
        game.active = true;
        game.turn = -1; // advanceSincerityTurn رح يخليها 0 (أول لاعب)
        await sock.sendMessage(from, { text: '🔥 ✦ *اللعبة بدأت! يلا صراحة كاملة* ✦' });
        await advanceSincerityTurn(sock, from);
      }

      // ---- ⏭️ تخطي دور (أدمن فقط) ----
      else if (command === '.تخطي_صراحة') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ لعبة الصراحة تشتغل بالقروبات فقط.' });
          return;
        }
        const game = sincerityGames[from];
        if (!game || !game.active) {
          await sock.sendMessage(from, { text: '⚠️ ما في لعبة صراحة شغالة حالياً.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        await sock.sendMessage(from, { text: '⏭️ تم تخطي الدور.' });
        await advanceSincerityTurn(sock, from);
      }

      // ---- 🏁 إنهاء اللعبة (صاحبها أو أدمن) ----
      else if (command === '.انهاء_صراحة') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ لعبة الصراحة تشتغل بالقروبات فقط.' });
          return;
        }
        const game = sincerityGames[from];
        if (!game) {
          await sock.sendMessage(from, { text: '⚠️ ما في لعبة صراحة شغالة حالياً.' });
          return;
        }
        if (sender !== game.hostSender && !(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ بس اللي بدأ اللعبة أو أدمن القروب يقدر ينهيها.' });
          return;
        }
        delete sincerityGames[from];
        await sock.sendMessage(from, {
          text:
            `╭─❍───────────────❍─╮\n` +
            `   🏁 *انتهت لعبة الصراحة* 🏁\n` +
            `╰─❍───────────────❍─╯\n` +
            `شكراً لكل اللي شاركوا! 💎✨`,
        });
      }

      // ================================================
      // 🏅 نظام النقاط والألقاب والجوائز
      // ================================================

      // ---- 🏅 نقاطي الخاصة ----
      // ==== 🎁 الهدية اليومية: نقاط مجانية مرة كل يوم + بونص لو رجعت أيام متتالية بلا انقطاع ====
      else if (command === '.هدية_يومية' || command === '.مكافأة_يومية') {
        const result = claimDailyReward(sender);

        if (result.alreadyClaimed) {
          await sock.sendMessage(from, {
            text: buildFancyCard(
              '⏳',
              'الهدية اليومية',
              `أخدت هديتك اليوم أصلاً! 🎁\n🔥 السلسلة الحالية: *${result.streak}* يوم متتالي\n\nرجعلك بكرة لهدية جديدة.`
            ),
          });
          return;
        }

        const streakLine = result.streak > 1
          ? `🔥 سلسلة *${result.streak}* يوم متتالي! (+${result.streakBonus} بونص)\n`
          : `🌱 أول يوم بسلسلتك — رجع بكرة تكبرها!\n`;

        await sock.sendMessage(from, {
          text: buildFancyCard(
            '🎁',
            'الهدية اليومية',
            `🎲 هديتك: *${result.base}* نقطة\n` +
              streakLine +
              `💰 المجموع اللي أخدته اليوم: *${result.total}* نقطة`,
            `📅 رجعلك بكرة تكمّل السلسلة (لو فاتك يوم، بترجع تبلش من الأول)`
          ),
        });
      }

      else if (command === '.نقاطي') {
        const myPoints = getPoints(sender);
        const rank = getRank(myPoints);
        const myShop = getShopEntry(sender);
        const nextInfo = rank.next
          ? `\n📈 باقيلك *${rank.next.min - myPoints}* نقطة عشان توصل لرتبة ${rank.next.emoji} *${rank.next.title}*`
          : '\n👑 وصلت لأعلى رتبة، إنت أسطورة فعلاً!';
        const titleLine = myShop && myShop.title
          ? `🏷️ اللقب المخصص: *${myShop.title}*\n`
          : '';
        const badgeLine = myShop && getEffectiveBadge(myShop)
          ? `${getEffectiveBadge(myShop)} الوسام النشط\n`
          : '';
        const vipLine = isPremiumActive(myShop)
          ? `💠 عضوية VIP شغالة لحد ${new Date(myShop.premiumUntil).toLocaleString('ar')}\n`
          : '';
        const doubleLine = myShop && myShop.doubleUntil && Date.now() < myShop.doubleUntil
          ? `⚡ مضاعفة النقاط شغالة لحد ${new Date(myShop.doubleUntil).toLocaleString('ar')}\n`
          : '';
        await sock.sendMessage(from, {
          text: buildFancyCard(
            '🏅',
            'بطاقة نقاطك',
            `💰 مجموع النقاط: *${myPoints}*\n` +
              `${rank.emoji} الرتبة الحالية: *${rank.title}*\n` +
              titleLine + badgeLine + vipLine + doubleLine +
              nextInfo,
            '🛒 اكتب .المتجر تشتري ألقاب ومميزات بنقاطك'
          ),
        });
      }

      // ---- 🏅 نقاط شخص معيّن (منشن) ----
      else if (command === '.نقاط') {
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        const target = mentioned && mentioned.length > 0 ? mentioned[0] : sender;
        const targetPoints = getPoints(target);
        const rank = getRank(targetPoints);
        const targetShop = getShopEntry(target);
        const titleLine = targetShop && targetShop.title
          ? `🏷️ اللقب: *${targetShop.title}*\n`
          : '';
        const badgeLine = targetShop && getEffectiveBadge(targetShop)
          ? `${getEffectiveBadge(targetShop)} وسام نشط\n`
          : '';
        const vipLine = isPremiumActive(targetShop) ? `💠 عضو VIP بريميوم\n` : '';
        await sock.sendMessage(from, {
          text: buildFancyCard(
            '🏅',
            `بطاقة نقاط @${target.split('@')[0]}`,
            `💰 مجموع النقاط: *${targetPoints}*\n` +
              `${rank.emoji} الرتبة: *${rank.title}*\n` +
              titleLine + badgeLine + vipLine
          ),
          mentions: [target],
        });
      }

      // ---- 💸 تحويل نقاط لشخص تاني ----
      else if (command === '.تحويل') {
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        const target = mentioned && mentioned.length > 0 ? mentioned[0] : null;
        const amountArg = args.find((a) => /^\d+$/.test(a));
        const amount = amountArg ? parseInt(amountArg, 10) : NaN;

        if (!target) {
          await sock.sendMessage(from, { text: '⚠️ لازم تمنشن الشخص، مثال: .تحويل @شخص 50' });
          return;
        }
        if (!amount || amount <= 0) {
          await sock.sendMessage(from, { text: '⚠️ حدد عدد صحيح من النقاط، مثال: .تحويل @شخص 50' });
          return;
        }

        // ==== 🔎 نحل معرّف @lid المستلم لرقم هاتفه الحقيقي (لو منشن جيده جاي بصيغة داخلية)،
        // حتى النقاط تروح لنفس المفتاح يلي بيشوفه هو لما يسوي .نقاطي، مش لمفتاح لِد وهمي ====
        const targetNumber = await resolveGroupMemberNumber(sock, isGroup ? from : null, target);
        const senderNumber = resolveOwnerNumber(sender);

        if (targetNumber === senderNumber) {
          await sock.sendMessage(from, { text: '⚠️ ما تقدر تحول نقاط لحالك 😅' });
          return;
        }
        const myPoints = getPoints(senderNumber);
        if (myPoints < amount) {
          await sock.sendMessage(from, {
            text: `❌ نقاطك مش كافية! معك *${myPoints}* بس وبدك تحول *${amount}*.`,
          });
          return;
        }
        if (!spendPoints(senderNumber, amount)) {
          await sock.sendMessage(from, { text: '❌ صار خطأ بعملية التحويل، جرب مرة ثانية.' });
          return;
        }
        addPoints(targetNumber, amount);
        await sock.sendMessage(from, {
          text:
            `💸 ✦ *تم التحويل!* ✦\n` +
            `@${senderNumber} حوّل *${amount}* نقطة لـ @${targetNumber}\n\n` +
            `💰 رصيدك المتبقي: ${getPoints(senderNumber)}`,
          mentions: [sender, target],
        });
      }

      // ---- 🏢 تمويل شركة أمونس العالمية — مالك البوت فقط، يضيف نقاط من الشركة مباشرة (بدون خصم من أي رصيد) ----
      else if (command === '.تمويل_الشركة' || command === '.تمويل') {
        if (!isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر حصراً لمالك البوت.*' });
          return;
        }
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        const fundTarget = mentioned && mentioned.length > 0 ? mentioned[0] : sender;
        const amountArg = args.find((a) => /^\d+$/.test(a));
        const amount = amountArg ? parseInt(amountArg, 10) : NaN;

        if (!amount || amount <= 0) {
          await sock.sendMessage(from, {
            text: '⚠️ حدد عدد صحيح من النقاط.\nمثال: .تمويل_الشركة 5000 (لنفسك)\nأو: .تمويل_الشركة 5000 @شخص (لشخص ثاني)',
          });
          return;
        }

        const newTotal = addPoints(fundTarget, amount);
        const divider = '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈';
        await sock.sendMessage(from, {
          text:
            '🏢 ⟪ تمويل شركة أمونس العالمية ⟫\n' +
            `${divider}\n` +
            `✅ تم تمويل @${fundTarget.split('@')[0]} مباشرة من خزينة الشركة\n` +
            `💵 المبلغ الممنوح: ${amount.toLocaleString('en-US')} نقطة\n` +
            `${divider}\n` +
            `💰 الرصيد الجديد: ${newTotal.toLocaleString('en-US')} نقطة\n` +
            `${divider}\n` +
            '🏢 شركة أمونس العالمية — بلا حدود لمالكها',
          mentions: [fundTarget],
        });
      }

      // ---- 📢 المالك يبعت رسالة واحدة لكل القروبات المتصلة دفعة وحدة (إعلانات، صيانة، تحديثات) ----
      else if (command === '.اذاعة' || command === '.بث') {
        if (!isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر حصراً لمالك البوت.*' });
          return;
        }
        const broadcastText = args.join(' ');
        if (!broadcastText) {
          await sock.sendMessage(from, { text: '⚠️ اكتب النص يلي بدك تذيعه بعد الأمر، مثال: .اذاعة البوت رح يوقف شوي للصيانة' });
          return;
        }

        const groupIds = Object.keys(groupStats);
        if (groupIds.length === 0) {
          await sock.sendMessage(from, { text: '📋 ما في قروبات مسجّلة عند البوت لسا.' });
          return;
        }

        await sock.sendMessage(from, { text: `📢 جاري الإذاعة لـ ${groupIds.length} قروب...` });
        let sentCount = 0;
        let failCount = 0;
        for (const groupId of groupIds) {
          try {
            await sock.sendMessage(groupId, {
              text: buildFancyCard('📢', 'إعلان من إدارة البوت', broadcastText),
            });
            sentCount++;
            await sleep(800); // مهلة صغيرة بين كل قروب والتاني حتى ما نضرب حد واتساب على الرسائل المتلاحقة
          } catch (e) {
            failCount++;
          }
        }
        await sock.sendMessage(from, {
          text: `✅ خلصت الإذاعة!\n📤 نجحت: ${sentCount}\n❌ فشلت: ${failCount}`,
        });
      }

      // ---- 🩺 فحص شامل لصحة النظام — مالك البوت فقط، يتأكد كل شيء شغال صح ويطلع تقرير واضح ----
      else if (command === '.فحص_النظام' || command === '.فحص') {
        if (!isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر حصراً لمالك البوت.*' });
          return;
        }

        const checks = [];

        // 1) فحص Jimp (بناء صورة السجن)
        try {
          const Jimp = require('jimp');
          const test = new Jimp(10, 10, '#000000');
          await test.getBufferAsync(Jimp.MIME_JPEG);
          checks.push({ ok: true, label: 'مكتبة الصور (Jimp) وصورة السجن' });
        } catch (e) {
          checks.push({ ok: false, label: 'مكتبة الصور (Jimp) وصورة السجن', err: e.message });
        }

        // 2) فحص حفظ الملفات (نقاط/إنذارات/حماية)
        try {
          saveJSON(POINTS_FILE, points);
          saveJSON(WARN_FILE, warnings);
          saveJSON(PROTECTION_FILE, protectionSettings);
          checks.push({ ok: true, label: 'حفظ ملفات البيانات (نقاط/إنذارات/حماية)' });
        } catch (e) {
          checks.push({ ok: false, label: 'حفظ ملفات البيانات (نقاط/إنذارات/حماية)', err: e.message });
        }

        // 3) فحص أدمنية البوت (بس لو الأمر انكتب جوا قروب)
        if (isGroup) {
          try {
            const botAdmin = await isBotAdminInGroup(sock, from);
            if (botAdmin === true) checks.push({ ok: true, label: 'صلاحية أدمن البوت بهاد القروب' });
            else if (botAdmin === false) checks.push({ ok: false, label: 'صلاحية أدمن البوت بهاد القروب', err: 'البوت مش أدمن هون' });
            else checks.push({ ok: null, label: 'صلاحية أدمن البوت بهاد القروب', err: 'ما قدرت أتأكد (خطأ اتصال مؤقت)' });
          } catch (e) {
            checks.push({ ok: false, label: 'صلاحية أدمن البوت بهاد القروب', err: e.message });
          }
        }

        // 4) فحص الاتصال بواتساب
        checks.push({ ok: !!sock.user, label: 'الاتصال بواتساب' });

        const uptimeMin = Math.floor(process.uptime() / 60);
        const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
        const passCount = checks.filter((c) => c.ok === true).length;
        const failCount = checks.filter((c) => c.ok === false).length;

        const lines = checks
          .map((c) => `${c.ok === true ? '✅' : c.ok === false ? '❌' : '⚠️'} ${c.label}${c.err ? ` — ${c.err}` : ''}`)
          .join('\n');

        await sock.sendMessage(from, {
          text: buildFancyCard(
            '🩺',
            'فحص شامل لنظام البوت',
            lines,
            `⏱️ مدة التشغيل: ${uptimeMin} دقيقة\n` +
              `💾 استهلاك الذاكرة: ${memMB} ميغابايت\n\n` +
              `${failCount === 0 ? '✅ كل شيء شغال تمام!' : `⚠️ في ${failCount} مشكلة لازم تتصلح`}`
          ),
        });
      }

      // ---- 🔁 إعادة تشغيل آمنة — يحفظ كل البيانات ثم يوقف العملية (لازم تشغّلها يدوياً تاني من Termux) ----
      else if (command === '.اعادة_تشغيل' || command === '.روستت') {
        if (!isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر حصراً لمالك البوت.*' });
          return;
        }
        await sock.sendMessage(from, {
          text:
            '🔁 ✦ *جاري حفظ كل البيانات وإعادة التشغيل...* ✦\n\n' +
            '⚠️ ملاحظة: البوت رح يوقف بعد الحفظ. إذا ما عندك سكربت تلقائي يشغّله من جديد،\n' +
            'لازم ترجع تكتب `node index.js` يدوياً بـ Termux.',
        });
        setTimeout(() => {
          saveAllDataOnExit();
        }, 1500);
      }

      // ---- 🏷️ عرض اليوم: غرض عشوائي بخصم، بيتغير كل يوم ----
      else if (command === '.عرض_اليوم') {
        const deal = getDailyDeal();
        if (!deal) {
          await sock.sendMessage(from, { text: '⚠️ ما في عروض حالياً.' });
          return;
        }
        const { item, discountPct, discountedPrice } = deal;
        await sock.sendMessage(from, {
          text:
            `🏷️✨ ✦ *عرض اليوم* ✦ ✨🏷️\n\n` +
            `${item.emoji || item.frame || '🎁'} *${item.name}*\n` +
            `~${item.price}~ نقطة ⬅️ *${discountedPrice}* نقطة (خصم ${discountPct}%)\n\n` +
            `🛍️ اشتريه الآن بـ: .شراء ${item.id}\n` +
            `⏰ العرض بيتغير غداً بغرض تاني!`,
        });
      }

      // ---- 🔨 بدء مزاد جديد (للأدمن/مالك البوت بس، وبالقروبات فقط) ----
      else if (command === '.بدء_مزاد') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ المزاد متاح بس جوا القروبات.' });
          return;
        }
        const allowed = await isAdminOrOwner(sock, from, sender);
        if (!allowed) {
          await sock.sendMessage(from, { text: '⚠️ بس الأدمن أو مالك البوت يقدر يبدأ مزاد.' });
          return;
        }
        if (auctions[from] && auctions[from].endsAt > Date.now()) {
          await sock.sendMessage(from, { text: '⚠️ في مزاد شغال أصلاً! اكتب .مزاد لتشوفه.' });
          return;
        }
        const item = getRandomAuctionItem();
        if (!item) {
          await sock.sendMessage(from, { text: '⚠️ ما في أغراض متاحة للمزاد حالياً.' });
          return;
        }
        auctions[from] = {
          itemId: item.id,
          currentBid: item.price,
          currentBidderKey: null,
          endsAt: Date.now() + AUCTION_DURATION_MS,
          startedBy: sender,
        };
        saveAuctions();
        await sock.sendMessage(from, {
          text:
            `🔨✨ ✦ *مزاد جديد بدأ!* ✦ ✨🔨\n\n` +
            `${item.emoji || item.frame} *${item.name}*\n` +
            `💰 سعر البداية: *${item.price}* نقطة\n` +
            `⏰ المدة: 15 دقيقة\n\n` +
            `زايد بـ: .مزايدة <عدد النقاط>`,
        });
      }

      // ---- 🔨 عرض حالة المزاد الحالي بالقروب ----
      else if (command === '.مزاد') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ المزاد متاح بس جوا القروبات.' });
          return;
        }
        if (auctions[from] && auctions[from].endsAt <= Date.now()) {
          await resolveAuction(sock, from);
        }
        const auction = auctions[from];
        if (!auction) {
          await sock.sendMessage(from, {
            text: '📭 ما في مزاد شغال حالياً.\n\nالأدمن يقدر يبدأ وحدة جديدة بـ .بدء_مزاد',
          });
          return;
        }
        const item = findShopItem(auction.itemId);
        const bidderLine = auction.currentBidderKey
          ? `👤 أعلى مزايدة: @${auction.currentBidderKey}`
          : '👤 ما في مزايدات لسا';
        await sock.sendMessage(from, {
          text:
            `🔨 ✦ *المزاد الحالي* ✦\n\n` +
            `${item.emoji || item.frame} *${item.name}*\n` +
            `💰 أعلى سعر: *${auction.currentBid}* نقطة\n` +
            `${bidderLine}\n` +
            `⏰ الوقت المتبقي: ${formatAuctionTimeLeft(auction.endsAt)}\n\n` +
            `زايد بـ: .مزايدة <عدد النقاط>`,
          mentions: auction.currentBidderKey ? [`${auction.currentBidderKey}@s.whatsapp.net`] : [],
        });
      }

      // ---- 🔨 المزايدة على المزاد الحالي ----
      else if (command === '.مزايدة') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ المزاد متاح بس جوا القروبات.' });
          return;
        }
        if (auctions[from] && auctions[from].endsAt <= Date.now()) {
          await resolveAuction(sock, from);
        }
        const auction = auctions[from];
        if (!auction) {
          await sock.sendMessage(from, { text: '⚠️ ما في مزاد شغال حالياً. الأدمن يبدأ وحدة بـ .بدء_مزاد' });
          return;
        }
        const bidAmount = parseInt((args[0] || '').trim(), 10);
        if (!bidAmount || bidAmount <= 0) {
          await sock.sendMessage(from, { text: '⚠️ حدد عدد صحيح من النقاط، مثال: .مزايدة 200' });
          return;
        }
        const minAllowed = auction.currentBid + AUCTION_MIN_INCREMENT;
        if (bidAmount < minAllowed) {
          await sock.sendMessage(from, { text: `⚠️ لازم تزايد على الأقل بـ *${minAllowed}* نقطة.` });
          return;
        }
        const myPoints = getPoints(sender);
        if (myPoints < bidAmount) {
          await sock.sendMessage(from, {
            text: `❌ نقاطك مش كافية! معك *${myPoints}* بس وبدك تزايد بـ *${bidAmount}*.`,
          });
          return;
        }
        if (pointsKey(sender) === auction.currentBidderKey) {
          await sock.sendMessage(from, { text: '⚠️ أنت أصلاً أعلى مزايدة!' });
          return;
        }
        auction.currentBid = bidAmount;
        auction.currentBidderKey = pointsKey(sender);
        saveAuctions();
        const item = findShopItem(auction.itemId);
        await sock.sendMessage(from, {
          text:
            `🔨 ✦ *مزايدة جديدة!* ✦\n\n` +
            `${item.emoji || item.frame} *${item.name}*\n` +
            `👤 @${sender.split('@')[0]} زايد بـ *${bidAmount}* نقطة\n` +
            `⏰ الوقت المتبقي: ${formatAuctionTimeLeft(auction.endsAt)}`,
          mentions: [sender],
        });
      }

      // ---- 📊 إحصائيات VIP (حصري لأعضاء البريميوم) ----
      else if (command === '.احصائياتي_VIP') {
        const entry = getShopEntry(sender);
        if (!isPremiumActive(entry)) {
          await sock.sendMessage(from, {
            text: '💠 هاد الأمر حصري لأعضاء VIP بريميوم بس! اكتب .شراء بريميوم_فضي (أو ذهبي/ماسي) لتفعيلها.',
          });
          return;
        }
        const myPoints = getPoints(sender);
        const rank = getRank(myPoints);
        await sock.sendMessage(from, {
          text:
            `📊 ✦ *إحصائياتك الحصرية VIP* ✦ 💠\n\n` +
            `💰 مجموع النقاط: *${myPoints}*\n` +
            `${rank.emoji} الرتبة: *${rank.title}*\n` +
            `🧾 مجموع ما صرفته بالمتجر طول عمرك: *${entry.totalSpent || 0}* نقطة\n` +
            `🎖 عدد الأوسمة المملوكة: *${entry.badges.length}*\n` +
            `🖼 عدد الإطارات المملوكة: *${entry.frames.length}*\n` +
            `🛡️ تذاكر حماية متبقية: *${entry.warnShields || 0}*\n` +
            `⏳ عضويتك شغالة لحد: ${new Date(entry.premiumUntil).toLocaleString('ar')}`,
        });
      }

      // ---- 🤖 سؤال ذكاء اصطناعي حصري لأعضاء VIP ----
      else if (command === '.اسأل_VIP') {
        const entry = getShopEntry(sender);
        if (!isPremiumActive(entry)) {
          await sock.sendMessage(from, {
            text: '💠 هاد الأمر حصري لأعضاء VIP بريميوم بس! اكتب .شراء بريميوم_فضي (أو ذهبي/ماسي) لتفعيلها.',
          });
          return;
        }
        const question = args.join(' ').trim();
        if (!question) {
          await sock.sendMessage(from, { text: '⚠️ اكتب سؤالك، مثال: .اسأل_VIP اشرحلي نظرية النسبية' });
          return;
        }
        try {
          const answer = await askGemini(
            `جاوب بالتفصيل وبعمق (اعتبر إنك بتجاوب عضو VIP مميز، خد وقتك بالشرح): ${question}`
          );
          await sock.sendMessage(from, { text: `🤖💠 ✦ *رد VIP الحصري* ✦\n\n${answer}` });
        } catch (e) {
          await sock.sendMessage(from, { text: '⚠️ صار خطأ بالرد، جرب مرة ثانية.' });
        }
      }


      else if (command === '.الترتيب' || command === '.المتصدرين') {
        const sorted = Object.entries(points)
          .filter(([, p]) => p > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);

        if (sorted.length === 0) {
          await sock.sendMessage(from, { text: '📋 ما في حدا سجّل نقاط لسا، كون أول واحد!' });
          return;
        }

        const medals = ['🥇', '🥈', '🥉'];
        const mentionsList = [];
        const lines = sorted.map(([userId, p], i) => {
          const jid = `${userId}@s.whatsapp.net`;
          mentionsList.push(jid);
          const medal = medals[i] || `${i + 1}.`;
          const display = getDisplayTitle(jid, p);
          return `${medal} @${userId} — *${p}* نقطة (${display})`;
        });

        await sock.sendMessage(from, {
          text: buildFancyCard('🏆', 'لوحة المتصدرين', lines.join('\n')),
          mentions: mentionsList,
        });
      }

      // ---- 🏆 لوحة الصدارة الأسبوعية (بتصفّر كل أحد تلقائياً) ----
      else if (command === '.المتصدرين_الاسبوع' || command === '.الترتيب_الاسبوعي') {
        const sorted = Object.entries(weeklyLeaderboard.points || {})
          .filter(([, p]) => p > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);

        if (sorted.length === 0) {
          await sock.sendMessage(from, {
            text: '📋 ما في حدا سجّل نقاط هالأسبوع لسا، كون أول واحد! 🔥',
          });
          return;
        }

        const medals = ['🥇', '🥈', '🥉'];
        const mentionsList = [];
        const lines = sorted.map(([userId, p], i) => {
          const jid = `${userId}@s.whatsapp.net`;
          mentionsList.push(jid);
          const medal = medals[i] || `${i + 1}.`;
          return `${medal} @${userId} — *${p}* نقطة هالأسبوع`;
        });

        const nextSunday = new Date(weeklyLeaderboard.weekStart);
        nextSunday.setDate(nextSunday.getDate() + 7);

        await sock.sendMessage(from, {
          text: buildFancyCard(
            '🏆',
            'لوحة الصدارة الأسبوعية',
            lines.join('\n'),
            '🔄 بتصفّر كل يوم أحد — استعجل واكسب نقاط قبل ما ينتهي الأسبوع!\n📜 اكتب .ارشيف_الابطال لتشوف أبطال الأسابيع الفائتة'
          ),
          mentions: mentionsList,
        });
      }

      // ---- 📜 أرشيف أبطال الأسابيع السابقة ----
      else if (command === '.ارشيف_الابطال' || command === '.ارشيف_الاسبوع') {
        if (!weeklyLeaderboard.archive || weeklyLeaderboard.archive.length === 0) {
          await sock.sendMessage(from, {
            text: '📋 ما في أرشيف لسا، لسا ما خلص أول أسبوع كامل.',
          });
          return;
        }

        const mentionsList = [];
        const weeksText = weeklyLeaderboard.archive
          .slice(0, 5)
          .map((week) => {
            const lines = week.top
              .map((t) => {
                mentionsList.push(`${t.userId}@s.whatsapp.net`);
                return `${t.medal} @${t.userId} — ${t.points} نقطة`;
              })
              .join('\n');
            return `🗓️ *أسبوع ${week.weekStart}*\n${lines}`;
          })
          .join('\n\n');

        await sock.sendMessage(from, {
          text: buildFancyCard('📜', 'أرشيف أبطال الأسابيع', weeksText),
          mentions: mentionsList,
        });
      }

      // ---- 🎁 قائمة الجوائز والرتب ----
      else if (command === '.الجوائز') {
        const lines = rankTiers
          .map((tier) => `${tier.emoji} *${tier.title}* — من ${tier.min} نقطة فما فوق`)
          .join('\n');
        const achievementLines = achievements
          .map((a) => `${a.emoji} *${a.name}* — عند الوصول لـ ${a.min} نقطة`)
          .join('\n');
        await sock.sendMessage(from, {
          text: buildFancyCard(
            '🎁',
            'الرتب والجوائز',
            `اجمع نقاط من فوزك بالألعاب وارتقي بالرتب:\n\n` +
              `${lines}\n\n` +
              `━━━ 🏆 ميداليات الإنجاز ━━━\n` +
              `${achievementLines}`,
            '✨ اكتب .نقاطي لتشوف رتبتك ومجموع نقاطك\n🏆 اكتب .الترتيب لتشوف أفضل 10 لاعبين\n🛒 اكتب .المتجر لتشتري ألقاب وأوسمة'
          ),
        });
      }

      // ---- 🦠 متجر أمونس الأسطوري: أغراض قوى خاصة بلعبة المافيا ----
      else if (command === '.متجر_المافيا') {
        const myPoints = getPoints(sender);
        const entry = getShopEntry(sender);
        const perkItems = shopItems.filter((it) => it.type === 'mafia_perk');
        const perkLines = perkItems
          .map((it) => {
            const owned = entry.mafiaPerks[it.perkKey] || 0;
            return `${it.name.split(' ')[0]} *${it.id}* — ${it.name} (${it.price} نقطة)\n   ↳ ${it.desc}\n   📦 عندك حالياً: ${owned}x`;
          })
          .join('\n\n');

        await sock.sendMessage(from, {
          text:
            `🦠⚔️ ✦ *متجر أمونس الأسطوري* ✦ ⚔️🦠\n` +
            `_قوى خطيرة... لأقوى اللاعبين بس_\n\n` +
            `${perkLines}\n\n` +
            `💰 رصيدك: ${myPoints} نقطة\n` +
            `🛍️ اشتري بـ: *.شراء <الاسم>* (مثال: .شراء درع_امونس)\n` +
            `📖 كل غرض بيُستهلك تلقائياً وقت اللزوم بأي لعبة مافيا تلعبها بعدين، محدا لازم يدير غير أنت.`,
        });
      }

      // ---- 🛒 عرض متجر النقاط ----
      else if (command === '.المتجر' || command === '.متجر_النقاط') {
        const myPoints = getPoints(sender);
        const titleItems = shopItems.filter((it) => it.type === 'title');
        const badgeItems = shopItems.filter((it) => it.type === 'badge' && !it.seasonal);
        const frameItems = shopItems.filter((it) => it.type === 'frame' && !it.seasonal);
        const doubleItems = shopItems.filter((it) => it.type === 'double');
        const premiumItems = shopItems.filter((it) => it.type === 'premium');
        const funItems = shopItems.filter((it) => ['warnshield', 'luckybox', 'dailytitle', 'nickname'].includes(it.type));
        const petItems = shopItems.filter((it) => it.type === 'pet');
        const seasonalItems = shopItems.filter((it) => it.seasonal);
        const availableSeasonal = seasonalItems.filter((it) => isSeasonalItemAvailable(it));

        const dealInfo = getDailyDeal();
        const dealLine = dealInfo
          ? `🏷️✨ ✦ *عرض اليوم* ✦ ✨🏷️\n${dealInfo.item.emoji || dealInfo.item.frame} *${dealInfo.item.name}* — ~${dealInfo.item.price}~ ⬅️ *${dealInfo.discountedPrice}* نقطة (خصم ${dealInfo.discountPct}%)\n\n`
          : '';

        const titleLines = titleItems
          .map((it) => `🏷️ *${it.id}* — ${it.name} (${it.price} نقطة)\n   ↳ ${it.desc}`)
          .join('\n');
        const badgeLines = badgeItems
          .map((it) => `${it.emoji} *${it.id}* — ${it.name} (${it.price} نقطة)`)
          .join('\n');
        const frameLines = frameItems
          .map((it) => `${it.frame} *${it.id}* — ${it.name} (${it.price} نقطة)`)
          .join('\n');
        const doubleLines = doubleItems
          .map((it) => `⚡ *${it.id}* — ${it.name} (${it.price} نقطة)`)
          .join('\n');
        const premiumLines = premiumItems
          .map((it) => `${it.emoji} *${it.id}* — ${it.name} (${it.price} نقطة)\n   ↳ ${it.desc}`)
          .join('\n\n');
        const funLines = funItems
          .map((it) => `✨ *${it.id}* — ${it.name} (${it.price} نقطة)\n   ↳ ${it.desc}`)
          .join('\n');
        const petLines = petItems
          .map((it) => `${it.emoji} *${it.id}* — ${it.name} (${it.price} نقطة)\n   ↳ ${it.desc}`)
          .join('\n\n');
        const seasonalLines = availableSeasonal.length > 0
          ? availableSeasonal
              .map((it) => `${it.emoji || it.frame} *${it.id}* — ${it.name} (${it.price} نقطة) 🔓 متاح الآن!`)
              .join('\n')
          : '🔒 ما في أغراض موسمية متاحة هلق، رح ترجع بموسمها.';

        await sock.sendMessage(from, {
          text:
            `🛒 ✦ *متجر النقاط* ✦\n\n` +
            `💰 رصيدك الحالي: *${myPoints}* نقطة\n\n` +
            dealLine +
            `━━━ 💠 فئات VIP بريميوم ━━━\n${premiumLines}\n\n` +
            `━━━ 🏷️ الألقاب ━━━\n${titleLines}\n\n` +
            `━━━ 🎖 الأوسمة (${badgeItems.length}) ━━━\n${badgeLines}\n\n` +
            `━━━ 🖼 إطارات البروفايل ━━━\n${frameLines}\n\n` +
            `━━━ ⚡ مضاعفات النقاط ━━━\n${doubleLines}\n\n` +
            `━━━ 🎁 أغراض خاصة ━━━\n${funLines}\n\n` +
            `━━━ 🐾 الحيوانات الأليفة الحصرية (${petItems.length}) ━━━\n${petLines}\n\n` +
            `━━━ 🍂 أغراض موسمية ━━━\n${seasonalLines}\n\n` +
            `📌 *طريقة الشراء:*\n` +
            `.شراء لقب <النص> — لشراء لقب مخصص\n` +
            `.شراء اسم_مستعار <النص> — لشراء اسم مستعار\n` +
            `.شراء <معرف_الغرض> — لباقي الأغراض (مثال: .شراء وسام_نار)\n\n` +
            `🎖 عندك أكتر من وسام؟ فعّل واحد منهم بـ .تفعيل_وسام <معرف>\n` +
            `🖼 عندك أكتر من إطار؟ فعّل واحد منهم بـ .تفعيل_اطار <معرف>\n` +
            `🐾 عندك أكتر من حيوان؟ فعّل واحد منهم بـ .تفعيل_حيوان <معرف>\n` +
            `💸 .تحويل @شخص <عدد> — تهدي نقاط لصديقك\n` +
            `🔨 .بدء_مزاد / .مزاد / .مزايدة <عدد> — مزاد الأغراض النادرة (بالقروبات)\n` +
            `🏷️ .عرض_اليوم — شوف خصم اليوم\n` +
            `👤 اكتب .بروفايلي لتشوف بروفايلك بصورتك\n` +
            `🐾 اكتب .حيواناتي لتشوف حيواناتك الأليفة\n` +
            `🎒 اكتب .مقتنياتي لتشوف كل اللي اشتريته\n\n` +
            `🦠 بدك تتقوى بلعبة المافيا؟ اكتب .متجر_المافيا لأغراض أمونس الأسطورية!`,
        });
      }

      // ---- 🛍 شراء عنصر من متجر النقاط ----
      else if (command === '.شراء') {
        if (args.length === 0) {
          await sock.sendMessage(from, { text: '⚠️ حدد شو بدك تشتري. اكتب .المتجر لتشوف الأغراض المتاحة.' });
          return;
        }

        const firstArg = args[0].trim();
        let item = null;
        let extraText = '';

        if (firstArg === 'لقب') {
          item = findShopItem('لقب');
          extraText = args.slice(1).join(' ').trim();
        } else if (firstArg === 'اسم_مستعار') {
          item = findShopItem('اسم_مستعار');
          extraText = args.slice(1).join(' ').trim();
        } else {
          item = findShopItem(firstArg);
        }

        if (!item) {
          await sock.sendMessage(from, { text: '⚠️ ما لقيت هيك غرض بالمتجر. اكتب .المتجر لتشوف الأغراض المتاحة.' });
          return;
        }

        // 🍂 فحص الأغراض الموسمية: ما بتنشترى إلا بموسمها
        if (!isSeasonalItemAvailable(item)) {
          await sock.sendMessage(from, { text: '⚠️ هاد غرض موسمي، مش متاح للشراء حالياً. رح يرجع بموسمه.' });
          return;
        }

        // 🏷️ لو الغرض هو عرض اليوم، منطبق الخصم تلقائياً
        const todayDeal = getDailyDeal();
        const effectivePrice = todayDeal && todayDeal.item.id === item.id ? todayDeal.discountedPrice : item.price;

        const myPoints = getPoints(sender);
        if (myPoints < effectivePrice) {
          await sock.sendMessage(from, {
            text: `❌ نقاطك مش كافية! بدك *${effectivePrice}* نقطة وعندك *${myPoints}* بس.`,
          });
          return;
        }

        if (item.type === 'title') {
          if (!extraText) {
            await sock.sendMessage(from, { text: '⚠️ لازم تكتب نص اللقب، مثال: .شراء لقب أسطورة القروب' });
            return;
          }
          if (extraText.length > 25) {
            await sock.sendMessage(from, { text: '⚠️ اللقب طويل كتير، خليه أقل من 25 حرف.' });
            return;
          }
          if (!spendPoints(sender, effectivePrice)) {
            await sock.sendMessage(from, { text: '❌ صار خطأ بعملية الشراء، جرب مرة ثانية.' });
            return;
          }
          const entry = getShopEntry(sender);
          entry.title = extraText;
          saveShop();
          await sock.sendMessage(from, {
            text: buildPurchaseReceipt(sender, item, effectivePrice, 'مبروك، اللقب اتفعّل!', [
              `لقبك الآن: *${extraText}*`,
              'رح يظهر ببطاقة نقاطك وبالترتيب وبروفايلك بدل رتبتك.',
            ]),
          });
        } else if (item.type === 'badge') {
          const entry = getShopEntry(sender);
          if (entry.badges.includes(item.id)) {
            await sock.sendMessage(from, { text: '⚠️ عندك هاد الوسام أصلاً!' });
            return;
          }
          if (!spendPoints(sender, effectivePrice)) {
            await sock.sendMessage(from, { text: '❌ صار خطأ بعملية الشراء، جرب مرة ثانية.' });
            return;
          }
          entry.badges.push(item.id);
          if (!entry.activeBadge) entry.activeBadge = item.emoji;
          saveShop();
          await sock.sendMessage(from, {
            text: buildPurchaseReceipt(sender, item, effectivePrice, 'مبروك، صار عندك الوسام!', [
              `فعّله بأمر .تفعيل_وسام ${item.id}`,
            ]),
          });
        } else if (item.type === 'frame') {
          const entry = getShopEntry(sender);
          if (entry.frames.includes(item.id)) {
            await sock.sendMessage(from, { text: '⚠️ عندك هاد الإطار أصلاً!' });
            return;
          }
          if (!spendPoints(sender, effectivePrice)) {
            await sock.sendMessage(from, { text: '❌ صار خطأ بعملية الشراء، جرب مرة ثانية.' });
            return;
          }
          entry.frames.push(item.id);
          if (!entry.activeFrame) entry.activeFrame = item.frame;
          saveShop();
          await sock.sendMessage(from, {
            text: buildPurchaseReceipt(sender, item, effectivePrice, 'مبروك، صار عندك الإطار!', [
              `فعّله بأمر .تفعيل_اطار ${item.id}`,
            ]),
          });
        } else if (item.type === 'double') {
          if (!spendPoints(sender, effectivePrice)) {
            await sock.sendMessage(from, { text: '❌ صار خطأ بعملية الشراء، جرب مرة ثانية.' });
            return;
          }
          const entry = getShopEntry(sender);
          const now = Date.now();
          const base = entry.doubleUntil && entry.doubleUntil > now ? entry.doubleUntil : now;
          entry.doubleUntil = base + item.hours * 60 * 60 * 1000;
          saveShop();
          const untilStr = new Date(entry.doubleUntil).toLocaleString('ar');
          await sock.sendMessage(from, {
            text: buildPurchaseReceipt(sender, item, effectivePrice, 'تفعّلت المضاعفة!', [
              `⚡ كل نقطة تكسبها من الألعاب رح تتضاعف ×2`,
              `شغالة لحد: ${untilStr}`,
            ]),
          });
        } else if (item.type === 'premium') {
          const entry = getShopEntry(sender);
          if (!spendPoints(sender, effectivePrice)) {
            await sock.sendMessage(from, { text: '❌ صار خطأ بعملية الشراء، جرب مرة ثانية.' });
            return;
          }
          const now = Date.now();
          const base = entry.premiumUntil && entry.premiumUntil > now ? entry.premiumUntil : now;
          entry.premiumUntil = base + item.hours * 60 * 60 * 1000;
          entry.activeBadge = item.emoji;
          entry.activeFrame = item.frame;
          entry.premiumMultiplier = item.multiplier || 3;
          entry.premiumTier = item.tier || null;
          // مضاعفة نقاط طول مدة البريميوم بس (متل نفس تاريخ الانتهاء)
          const doubleBase = entry.doubleUntil && entry.doubleUntil > now ? entry.doubleUntil : now;
          entry.doubleUntil = Math.max(doubleBase, entry.premiumUntil);
          saveShop();
          const untilStr = new Date(entry.premiumUntil).toLocaleString('ar');
          await sock.sendMessage(from, {
            text: buildPurchaseReceipt(sender, item, effectivePrice, `مبروووك، صرت عضو VIP ${item.tier || ''}!`, [
              `${item.emoji} وسام حصري مفعّل`,
              `${item.frame} إطار حصري مفعّل`,
              `⚡ مضاعفة نقاط ×${item.multiplier || 3} طول مدة العضوية`,
              '🛡️ حصانة من إنذارات النظام التلقائية',
              '📊 .احصائياتي_VIP — إحصائيات حصرية',
              '🤖 .اسأل_VIP <سؤال> — سؤال ذكاء اصطناعي حصري',
              `🏷️ علامة ${item.emoji}VIP هتظهر جنب اسمك بكل مكان بالبوت`,
              `⏳ شغالة لحد: ${untilStr} — بعدها لازم تجددها بـ.شراء ${item.id}`,
            ]),
          });
        } else if (item.type === 'warnshield') {
          const entry = getShopEntry(sender);
          if (!spendPoints(sender, effectivePrice)) {
            await sock.sendMessage(from, { text: '❌ صار خطأ بعملية الشراء، جرب مرة ثانية.' });
            return;
          }
          entry.warnShields = (entry.warnShields || 0) + 1;
          saveShop();
          await sock.sendMessage(from, {
            text: buildPurchaseReceipt(sender, item, effectivePrice, 'اشتريت تذكرة حماية!', [
              `🛡️ عندك الآن ${entry.warnShields} تذكرة/تذاكر حماية شغالة`,
            ]),
          });
        } else if (item.type === 'mafia_perk') {
          if (!spendPoints(sender, effectivePrice)) {
            await sock.sendMessage(from, { text: '❌ صار خطأ بعملية الشراء، جرب مرة ثانية.' });
            return;
          }
          const entry = getShopEntry(sender);
          entry.mafiaPerks[item.perkKey] = (entry.mafiaPerks[item.perkKey] || 0) + 1;
          saveShop();
          await sock.sendMessage(from, {
            text: buildPurchaseReceipt(sender, item, effectivePrice, 'مبروك، صرت من أساطير أمونس!', [
              `عندك الآن ${entry.mafiaPerks[item.perkKey]}x جاهز للاستخدام`,
              item.desc,
            ]),
          });
        } else if (item.type === 'luckybox') {
          if (!spendPoints(sender, effectivePrice)) {
            await sock.sendMessage(from, { text: '❌ صار خطأ بعملية الشراء، جرب مرة ثانية.' });
            return;
          }
          const result = rollLuckyBox();
          let resultText;
          if (result > 0) {
            addPoints(sender, result);
            resultText = `🎉 ربحت *${result}* نقطة إضافية!`;
          } else if (result < 0) {
            const key = pointsKey(sender);
            points[key] = Math.max(0, (points[key] || 0) - Math.abs(result));
            saveJSON(POINTS_FILE, points);
            resultText = `😅 للأسف خسرت *${Math.abs(result)}* نقطة!`;
          } else {
            resultText = `📦 فتحت الصندوق... وطلع فاضي! حظ أوفر المرة الجاية 🤷`;
          }
          await sock.sendMessage(from, {
            text: buildPurchaseReceipt(sender, item, effectivePrice, 'فتحت صندوق الحظ!', [resultText]),
          });
        } else if (item.type === 'dailytitle') {
          const entry = getShopEntry(sender);
          if (entry.dailyTitleActive) {
            await sock.sendMessage(from, { text: '⚠️ عندك اشتراك اللقب اليومي شغال أصلاً!' });
            return;
          }
          if (!spendPoints(sender, effectivePrice)) {
            await sock.sendMessage(from, { text: '❌ صار خطأ بعملية الشراء، جرب مرة ثانية.' });
            return;
          }
          entry.dailyTitleActive = true;
          saveShop();
          const todayTitle = getDailyTitleFor(pointsKey(sender));
          await sock.sendMessage(from, {
            text: buildPurchaseReceipt(sender, item, effectivePrice, 'تفعّل اللقب اليومي!', [
              `🎭 لقبك اليوم: *${todayTitle}*`,
              'رح يتبدل تلقائياً كل يوم (ما بيشتغل إذا عندك لقب مخصص مفعّل).',
            ]),
          });
        } else if (item.type === 'nickname') {
          if (!extraText) {
            await sock.sendMessage(from, { text: '⚠️ لازم تكتب النص، مثال: .شراء اسم_مستعار الوحش' });
            return;
          }
          if (extraText.length > 20) {
            await sock.sendMessage(from, { text: '⚠️ الاسم طويل كتير، خليه أقل من 20 حرف.' });
            return;
          }
          if (!spendPoints(sender, effectivePrice)) {
            await sock.sendMessage(from, { text: '❌ صار خطأ بعملية الشراء، جرب مرة ثانية.' });
            return;
          }
          const entry = getShopEntry(sender);
          entry.nickname = extraText;
          saveShop();
          await sock.sendMessage(from, {
            text: buildPurchaseReceipt(sender, item, effectivePrice, 'صار عندك اسم مستعار!', [
              `📛 *${extraText}*`,
              'راح يظهر بمقتنياتك وبروفايلك.',
            ]),
          });
        } else if (item.type === 'pet') {
          const entry = getShopEntry(sender);
          if (entry.pets.includes(item.id)) {
            await sock.sendMessage(from, { text: '⚠️ عندك هاد الحيوان أصلاً!' });
            return;
          }
          if (!spendPoints(sender, effectivePrice)) {
            await sock.sendMessage(from, { text: '❌ صار خطأ بعملية الشراء، جرب مرة ثانية.' });
            return;
          }
          entry.pets.push(item.id);
          if (!entry.activePet) entry.activePet = item.id; // أول حيوان تشتريه يتفعّل تلقائياً
          saveShop();
          await sock.sendMessage(from, {
            text: buildPurchaseReceipt(sender, item, effectivePrice, `مبروك، صار عندك ${item.emoji} ${item.name}!`, [
              item.desc,
              entry.activePet === item.id ? '🟢 تم تفعيله تلقائياً!' : `فعّله بـ .تفعيل_حيوان ${item.id}`,
            ]),
          });
        }
      }

      // ---- 🔒 أمر سري (مش موجود بأي قائمة مساعدة): مالك البوت بس يقدر يمنح VIP مجاناً لأي شخص ----
      // الاستخدام: .اشتراك_VIP @شخص فضي (أو ذهبي أو ماسي) — لو ما حددت فئة، بينمنح ذهبي افتراضياً
      else if (command === '.اشتراك_VIP') {
        if (!isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '⛔ هاد الأمر حصراً لمالك البوت.' });
          return;
        }
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        const targetJid = mentioned && mentioned.length > 0 ? mentioned[0] : sender;

        const tierArg = (args.find((a) => !a.startsWith('@')) || 'ذهبي').trim();
        const tierMap = { فضي: 'بريميوم_فضي', ذهبي: 'بريميوم_ذهبي', ماسي: 'بريميوم_ماسي' };
        const itemId = tierMap[tierArg] || tierMap['ذهبي'];
        const item = findShopItem(itemId);

        const entry = getShopEntry(targetJid);
        const now = Date.now();
        const base = entry.premiumUntil && entry.premiumUntil > now ? entry.premiumUntil : now;
        entry.premiumUntil = base + item.hours * 60 * 60 * 1000;
        entry.activeBadge = item.emoji;
        entry.activeFrame = item.frame;
        entry.premiumMultiplier = item.multiplier || 3;
        entry.premiumTier = item.tier || null;
        const doubleBase = entry.doubleUntil && entry.doubleUntil > now ? entry.doubleUntil : now;
        entry.doubleUntil = Math.max(doubleBase, entry.premiumUntil);
        saveShop();

        const untilStr = new Date(entry.premiumUntil).toLocaleString('ar');
        await sock.sendMessage(from, {
          text:
            `🔒✅ ✦ *تم منح عضوية VIP ${item.tier} مجاناً!* ✦\n\n` +
            `👤 لـ: @${targetJid.split('@')[0]}\n` +
            `${item.emoji} وسام حصري + ${item.frame} إطار حصري مفعّلين\n` +
            `⚡ مضاعفة نقاط ×${item.multiplier}\n` +
            `⏳ شغالة لحد: ${untilStr}`,
          mentions: [targetJid],
        });
      }

      // ---- 🎖 تفعيل وسام من ضمن اللي اشتريتهم ----
      else if (command === '.تفعيل_وسام') {
        const id = (args[0] || '').trim();
        const entry = getShopEntry(sender);
        if (!id) {
          await sock.sendMessage(from, { text: '⚠️ حدد معرف الوسام، مثال: .تفعيل_وسام وسام_نار' });
          return;
        }
        if (!entry.badges.includes(id)) {
          await sock.sendMessage(from, { text: '⚠️ ما عندك هاد الوسام. اكتب .مقتنياتي لتشوف أوسمتك.' });
          return;
        }
        const item = findShopItem(id);
        entry.activeBadge = item ? item.emoji : entry.activeBadge;
        saveShop();
        await sock.sendMessage(from, { text: `✅ تم تفعيل الوسام ${entry.activeBadge} بنجاح!` });
      }

      // ---- 🖼 تفعيل إطار من ضمن اللي اشتريتهم ----
      else if (command === '.تفعيل_اطار') {
        const id = (args[0] || '').trim();
        const entry = getShopEntry(sender);
        if (!id) {
          await sock.sendMessage(from, { text: '⚠️ حدد معرف الإطار، مثال: .تفعيل_اطار اطار_ناري' });
          return;
        }
        if (!entry.frames.includes(id)) {
          await sock.sendMessage(from, { text: '⚠️ ما عندك هاد الإطار. اكتب .مقتنياتي لتشوف إطاراتك.' });
          return;
        }
        const item = findShopItem(id);
        entry.activeFrame = item ? item.frame : entry.activeFrame;
        saveShop();
        await sock.sendMessage(from, { text: `✅ تم تفعيل الإطار ${entry.activeFrame} بنجاح!` });
      }

      // ---- 🐾 تفعيل حيوان أليف من ضمن اللي اشتريتهم (يعطي مضاعفة نقاط حسب قدرته الخاصة) ----
      else if (command === '.تفعيل_حيوان') {
        const id = (args[0] || '').trim();
        const entry = getShopEntry(sender);
        if (!id) {
          await sock.sendMessage(from, { text: '⚠️ حدد معرف الحيوان، مثال: .تفعيل_حيوان قطة_الحظ\nاكتب .حيواناتي لتشوف حيواناتك.' });
          return;
        }
        if (!entry.pets.includes(id)) {
          await sock.sendMessage(from, { text: '⚠️ ما عندك هاد الحيوان. اكتب .حيواناتي لتشوف حيواناتك.' });
          return;
        }
        const item = findShopItem(id);
        entry.activePet = id;
        saveShop();
        await sock.sendMessage(from, {
          text: `✅ ✦ *تم تفعيل ${item.emoji} ${item.name}!* ✦\n${item.desc}`,
        });
      }

      // ---- 🐾 عرض كل الحيوانات الأليفة اللي اشتراها الشخص، والحيوان النشط حالياً ----
      else if (command === '.حيواناتي') {
        const entry = getShopEntry(sender);
        if (entry.pets.length === 0) {
          await sock.sendMessage(from, {
            text: '🐾 ما عندك حيوانات أليفة لسا.\nشوف الحيوانات المتاحة بـ .المتجر (قسم 🐾 الحيوانات الأليفة الحصرية)',
          });
          return;
        }
        const list = entry.pets
          .map((id) => {
            const it = findShopItem(id);
            if (!it) return null;
            const activeTag = entry.activePet === id ? ' 🟢 (نشط)' : '';
            return `${it.emoji} *${it.name}*${activeTag}\n   ↳ +${it.bonusPercent}% نقاط إضافية`;
          })
          .filter(Boolean)
          .join('\n\n');
        await sock.sendMessage(from, {
          text: `🐾 ✦ *حيواناتك الأليفة* ✦\n\n${list}\n\nبدّل الحيوان النشط بـ: .تفعيل_حيوان <معرف>`,
        });
      }

      // ---- 🎒 عرض مقتنيات المتجر الخاصة فيك ----
      else if (command === '.مقتنياتي') {
        const entry = getShopEntry(sender);
        const titleLine = entry.title ? `🏷️ اللقب: *${entry.title}*\n` : '🏷️ ما اشتريت لقب لسا\n';
        const badgesLine = entry.badges.length > 0
          ? `🎖 الأوسمة: ${entry.badges.map((id) => findShopItem(id)?.emoji || '').join(' ')}\n`
          : '🎖 ما اشتريت أوسمة لسا\n';
        const framesLine = entry.frames.length > 0
          ? `🖼 الإطارات: ${entry.frames.map((id) => findShopItem(id)?.frame || '').join(' ')}\n`
          : '🖼 ما اشتريت إطارات لسا\n';
        const activeLine = getEffectiveBadge(entry) ? `✨ الوسام النشط: ${getEffectiveBadge(entry)}\n` : '';
        const activeFrameLine = getEffectiveFrame(entry) ? `✨ الإطار النشط: ${getEffectiveFrame(entry)}\n` : '';
        const doubleLine = entry.doubleUntil && Date.now() < entry.doubleUntil
          ? `⚡ مضاعفة النقاط شغالة لحد: ${new Date(entry.doubleUntil).toLocaleString('ar')}\n`
          : '';
        const premiumLine = isPremiumActive(entry)
          ? `💠 ✦ *عضو VIP ${entry.premiumTier || ''}* ✦ (مضاعفة ×${entry.premiumMultiplier || 3}) شغالة لحد: ${new Date(entry.premiumUntil).toLocaleString('ar')}\n`
          : '';
        const nicknameLine = entry.nickname ? `📛 الاسم المستعار: *${entry.nickname}*\n` : '';
        const dailyTitleLine = entry.dailyTitleActive ? `🎭 اللقب اليومي مفعّل (اليوم: ${getDailyTitleFor(pointsKey(sender))})\n` : '';
        const shieldsLine = entry.warnShields > 0 ? `🛡️ تذاكر حماية متبقية: *${entry.warnShields}*\n` : '';
        const petsLine = entry.pets.length > 0
          ? `🐾 الحيوانات: ${entry.pets.map((id) => findShopItem(id)?.emoji || '').join(' ')}${entry.activePet ? ` (النشط: ${findShopItem(entry.activePet)?.emoji || ''})` : ''}\n`
          : '';
        const spentLine = entry.totalSpent > 0 ? `🧾 مجموع ما صرفته بالمتجر: *${entry.totalSpent}* نقطة\n` : '';
        const mp = entry.mafiaPerks || {};
        const mafiaPerksList = [
          mp.shield > 0 ? `🛡️ درع أمونس ×${mp.shield}` : null,
          mp.doubleVote > 0 ? `👑 نفوذ أمونس ×${mp.doubleVote}` : null,
          mp.disguise > 0 ? `🎭 قناع أمونس ×${mp.disguise}` : null,
          mp.revive > 0 ? `💀 بعث أمونس ×${mp.revive}` : null,
        ].filter(Boolean);
        const mafiaPerksLine = mafiaPerksList.length > 0 ? `🦠 أغراض أمونس (مافيا): ${mafiaPerksList.join(' | ')}\n` : '';
        await sock.sendMessage(from, {
          text: `🎒 ✦ *مقتنياتك من المتجر* ✦\n\n${premiumLine}${titleLine}${nicknameLine}${dailyTitleLine}${badgesLine}${framesLine}${activeLine}${activeFrameLine}${doubleLine}${shieldsLine}${petsLine}${mafiaPerksLine}${spentLine}`,
        });
      }

      // ---- 👤 بروفايل شخصي بصورة الواتساب ----
      // ==== 💳 بطاقة بنك أمونس البنكية — نسخة مرئية من نقاطك بشكل بطاقة حساب بنكي ====
      // ==== 💳 بطاقة بنك أمونس البنكية — نسخة فاخرة: تدرّج أدق، رقم حساب، شريط تقدم، ترتيبك بين الكل ====
      else if (command === '.بطاقتي' || command === '.بطاقة_بنكية' || command === '.بنك_امونس') {
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        const target = mentioned && mentioned.length > 0 ? mentioned[0] : sender;
        const targetPoints = getPoints(target);

        // ==== 📊 7 درجات مالية بدل 5، تدرّج أنعم وإحساس أفخم بالتقدم ====
        const tiers = [
          { min: 0, max: 100, emoji: '🥀', label: 'مفلس' },
          { min: 100, max: 5000, emoji: '😕', label: 'فقير' },
          { min: 5000, max: 30000, emoji: '🙂', label: 'متوسط الحال' },
          { min: 30000, max: 100000, emoji: '💵', label: 'غني' },
          { min: 100000, max: 1000000, emoji: '💎', label: 'ثري جداً' },
          { min: 1000000, max: 9000000, emoji: '💰', label: 'مليونير' },
          { min: 9000000, max: Infinity, emoji: '👑', label: 'ملياردير' },
        ];
        const tierIdx = tiers.findIndex((t) => targetPoints >= t.min && targetPoints < t.max);
        const tier = tiers[tierIdx];
        const nextTier = tiers[tierIdx + 1] || null;

        // ==== 📶 شريط تقدم نحو الدرجة الجاية (فاضي كامل لو وصل أعلى درجة) ====
        let progressBar, progressLine;
        if (!nextTier) {
          progressBar = '█████████████ 💯';
          progressLine = `📶 التقدم: ${progressBar} (أعلى درجة!)`;
        } else {
          const ratio = Math.min(1, Math.max(0, (targetPoints - tier.min) / (tier.max - tier.min)));
          const filled = Math.round(ratio * 13);
          progressBar = '█'.repeat(filled) + '░'.repeat(13 - filled);
          const remaining = (tier.max - targetPoints).toLocaleString('en-US');
          progressLine = `📶 التقدم: ${progressBar}\n⏫ باقيلك ${remaining} نقطة لدرجة ${nextTier.emoji} ${nextTier.label}`;
        }

        // ==== 🔢 رقم حساب بنكي ثابت لكل شخص (مبني من رقمه، بيضل نفسه دايماً) ====
        let hash = 0;
        for (let i = 0; i < target.length; i++) hash = (hash * 31 + target.charCodeAt(i)) >>> 0;
        const accStr = String(hash).padStart(10, '0').slice(0, 10);
        const accountNumber = `AM-${accStr.slice(0, 4)}-${accStr.slice(4, 7)}-${accStr.slice(7, 10)}`;

        // ==== 🏅 ترتيب صاحب البطاقة بين كل اللاعبين المسجلين بالبوت ====
        const allRanked = Object.entries(points).sort((a, b) => b[1] - a[1]);
        const myKey = pointsKey(target);
        const rankPos = allRanked.findIndex(([k]) => k === myKey) + 1;
        const rankLine = rankPos > 0 ? `🏅 ترتيبك: #${rankPos} من أصل ${allRanked.length} حساب` : '🏅 ترتيبك: حساب جديد';

        // ==== 💎 شارة VIP لو عنده اشتراك بريميوم فعّال بالمتجر ====
        const targetShop = getShopEntry(target);
        const now = Date.now();
        const isPremium = targetShop.premiumUntil && new Date(targetShop.premiumUntil).getTime() > now;
        const vipLine = isPremium
          ? `💎 عضوية VIP نشطة: ${targetShop.premiumTier || 'فضية'} ✦\n`
          : '';
        const spentLine = targetShop.totalSpent > 0 ? `🧾 مصروفاتك على الرفاهية: ${targetShop.totalSpent.toLocaleString('en-US')} نقطة\n` : '';

        const wealthFormatted = targetPoints.toLocaleString('en-US');

        const divider = '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈';
        const card =
          '💳 ⟪ بنك أمونس ⟫\n' +
          `${divider}\n` +
          `👤 الحساب: @${target.split('@')[0]}\n` +
          `🔢 الرقم: ${accountNumber}\n` +
          vipLine +
          `${divider}\n` +
          `💰 الثروة: ${wealthFormatted} نقطة\n` +
          `📊 الحالة: ${tier.emoji} ${tier.label}\n` +
          `${progressLine}\n` +
          `${rankLine}\n` +
          spentLine +
          `${divider}\n` +
          '🏢 شركة أمونس العالمية\n' +
          '↳ الجهة المالكة والمتحكمة بالبنك 🏦، المتجر 🛍️، والألعاب 🎮\n' +
          `↳ مملوكة بالكامل لـ ${DEVELOPER_NAME}\n` +
          '✦ العب ألعاب واكسب نقاط 💸\n' +
          '✦ .المتجر لتصرف نقاطك 🛍️\n' +
          `${divider}\n` +
          '𝐊𝐇-𝐖𝐀𝐋𝐊𝐄𝐑';

        await sock.sendMessage(from, { text: card, mentions: [target] });
      }

      else if (command === '.بروفايلي' || command === '.بروفايل') {
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        const target = mentioned && mentioned.length > 0 ? mentioned[0] : sender;
        const targetPoints = getPoints(target);
        const rank = getRank(targetPoints);
        const targetShop = getShopEntry(target);
        const earned = getEarnedAchievements(targetPoints);

        const displayLine = getDisplayTitle(target, targetPoints);
        const achievementsLine = earned.length > 0
          ? `🏆 الميداليات: ${earned.map((a) => a.emoji).join(' ')}\n`
          : '🏆 ما فتح ميداليات لسا\n';
        const nextInfo = rank.next
          ? `📈 باقيله *${rank.next.min - targetPoints}* نقطة لرتبة ${rank.next.emoji} *${rank.next.title}*\n`
          : '👑 وصل لأعلى رتبة!\n';
        const targetStats = getStatsEntry(target);
        const bioLine = targetStats.bio ? `📝 ${targetStats.bio}\n\n` : '';
        const spouseKey = getSpouseKey(target);
        const spouseLine = spouseKey ? `💍 متزوج من @${spouseKey}\n\n` : '';

        const caption = buildFancyCard(
          '👤',
          `بروفايل @${target.split('@')[0]}`,
          bioLine +
            spouseLine +
            `${displayLine}\n\n` +
            `💰 مجموع النقاط: *${targetPoints}*\n` +
            achievementsLine +
            nextInfo,
          '🛒 .المتجر لشراء المزيد | 🏆 .انجازاتي لباقي الإنجازات'
        );

        let picUrl = null;
        try {
          picUrl = await sock.profilePictureUrl(target, 'image');
        } catch (e) {
          picUrl = null;
        }

        if (picUrl) {
          await sock.sendMessage(from, { image: { url: picUrl }, caption, mentions: [target] });
        } else {
          await sock.sendMessage(from, {
            text: `${caption}\n\n📷 (ما قدرت أجيب صورة البروفايل)`,
            mentions: [target],
          });
        }
      }

      // ---- 🎉 بدء فعالية الألعاب المتتالية ----
      else if (command === '.فعالية') {
        if (activeEvents[from]) {
          await sock.sendMessage(from, { text: '⚠️ الفعالية شغالة أصلاً! اكتب .انهاء_الفعالية لإيقافها.' });
          return;
        }
        activeEvents[from] = true;
        await sock.sendMessage(from, {
          text:
            '🎉 ✦ *بدأت فعالية الألعاب!* ✦\n\n' +
            'رح يبعتلكم البوت ألعاب متنوعة تلقائياً واحدة ورا الثانية، بدون ما تكتبوا أي أمر.\n' +
            'كل فوز = نقاط 🏅\n\n' +
            'لإيقاف الفعالية بأي وقت اكتبوا: .انهاء_الفعالية',
        });
        await startRandomGame(sock, from);
      }

      // ---- 🛑 إنهاء فعالية الألعاب المتتالية ----
      else if (command === '.انهاء_الفعالية') {
        if (!activeEvents[from]) {
          await sock.sendMessage(from, { text: '⚠️ ما في فعالية شغالة حالياً.' });
          return;
        }
        delete activeEvents[from];
        // نمسح أي لعبة شغالة حالياً بهاد الشات
        delete numberGames[from];
        delete quizGames[from];
        delete speedGames[from];
        delete mathGames[from];
        delete scrambleGames[from];
        delete riddleGames[from];
        delete trueFalseGames[from];
        delete flagGames[from];
        delete proverbGames[from];
        delete figureGames[from];
        delete blankGames[from];
        await sock.sendMessage(from, { text: '🛑 ✦ *تم إنهاء الفعالية* ✦\n\nشكراً لمشاركتكم! اكتبوا .الترتيب لتشوفوا النتائج 🏆' });
      }

      // ---- 👨‍💻 معلومات التواصل مع المطور ----
      else if (command === '.المطور' || command === '.تواصل') {
        // ==== 👨‍💻 بطاقة جهة اتصال حقيقية (vCard) — تظهر كبطاقة قابلة للنقر يرسل منها رسالة مباشرة أو يحفظها كجهة اتصال ====
        const vcard =
          'BEGIN:VCARD\n' +
          'VERSION:3.0\n' +
          `FN:${DEVELOPER_NAME}\n` +
          `TEL;type=CELL;type=VOICE;waid=${DEVELOPER_NUMBER}:+${DEVELOPER_NUMBER}\n` +
          'END:VCARD';

        await sock.sendMessage(from, {
          contacts: {
            displayName: DEVELOPER_NAME,
            contacts: [{ vcard }],
          },
        });

        // ==== 🎵 مقطع صوتي خاص بالمطور (لو الملف موجود) ====
        const developerAudioPath = '/data/data/com.termux/files/home/mybot/developer_audio.mp3';
        if (fs.existsSync(developerAudioPath)) {
          try {
            await sock.sendMessage(from, {
              audio: fs.readFileSync(developerAudioPath),
              mimetype: 'audio/mpeg',
              ptt: false, // ملف MP3 عادي (مش رسالة صوتية بالميكروفون) — رسائل ptt لازم تكون OGG/Opus وإلا بتفشل بالتشغيل
            });
          } catch (e) {
            console.log('⚠️ ما قدرت أبعت الصوت الخاص بأمر .المطور:', e.message);
          }
        }

        // ==== 🎥 فيديو دائري (Video Note) خاص بالمطور (لو الملف موجود) — نفس الفيديوهات الدائرية العادية بواتساب ====
        const developerVideoPath = '/data/data/com.termux/files/home/mybot/developer_video.mp4';
        if (fs.existsSync(developerVideoPath)) {
          try {
            await sock.sendMessage(from, {
              video: fs.readFileSync(developerVideoPath),
              ptv: true, // ptv = فيديو دائري (Video Note) بدل فيديو عادي مربع
            });
          } catch (e) {
            console.log('⚠️ ما قدرت أبعت الفيديو الدائري الخاص بأمر .المطور:', e.message);
          }
        }
      }

      // ==== 📢 عرض بطاقة القناة الرسمية — يحاول يجيب البيانات الحية (اسم/وصف/متابعين) من واتساب مباشرة،
      // ولو فشلت (نسخة مكتبة قديمة) بيرجع تلقائياً للبيانات الثابتة بدل ما يفشل الأمر بالكامل ====
      else if (command === '.قناتنا' || command === '.قناتي' || command === '.القناة') {
        let name = CHANNEL_NAME_FALLBACK;
        let description = CHANNEL_DESC_FALLBACK;
        let subscribers = null;
        let createdText = null;
        let pictureUrl = null;
        let channelJid = null;

        try {
          const meta = await sock.newsletterMetadata('invite', CHANNEL_INVITE_CODE);
          if (meta) {
            channelJid = meta.id || null;
            name = meta.name?.text || meta.thread_metadata?.name?.text || meta.subject || name;
            description = meta.description?.text || meta.thread_metadata?.description?.text || description;
            subscribers = meta.subscribers_count ?? meta.thread_metadata?.subscribers_count ?? null;
            const createdRaw = meta.creation_time || meta.thread_metadata?.creation_time;
            if (createdRaw) {
              createdText = new Date(Number(createdRaw) * 1000).toLocaleDateString('ar-EG');
            }
            pictureUrl =
              meta.preview?.url || meta.picture?.url || meta.thread_metadata?.preview?.url || null;
          }
        } catch (e) {
          console.log('⚠️ ما قدرت أجيب بيانات القناة تلقائياً (بستخدم البيانات الثابتة):', e.message);
        }

        // ==== 🟢 محاولة أولى: نبني نفس عنصر "عرض القناة" الأصلي يلي واتساب بيحطه تلقائياً تحت رسائل
        // معاد توجيهها من قناة. هاد بيحتاج الـ JID الحقيقي للقناة (جبناه فوق من newsletterMetadata) ====
        if (channelJid) {
          try {
            await sock.sendMessage(from, {
              text: `📢 *${name}*\n\n${description}`,
              contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: channelJid,
                  newsletterName: name,
                  serverMessageId: 1,
                },
              },
            });
            return; // نجحت المحاولة الأولى، ما في داعي نكمل للاحتياط
          } catch (e) {
            console.log('⚠️ ما ضبطت محاولة "عرض القناة" الأصلية، بترجع للبطاقة العادية:', e.message);
          }
        }

        // ==== 🔁 احتياط: لو ما توفر الـ JID أو فشلت المحاولة الأولى (نسخة مكتبة قديمة)، منرجع لبطاقة عادية ====
        const body =
          `📛 الاسم: *${name}*\n` +
          (subscribers !== null ? `👥 المتابعين: *${subscribers}*\n` : '') +
          (createdText ? `📅 أُنشئت: ${createdText}\n` : '') +
          `\n📝 ${description}\n\n` +
          `🔗 ${CHANNEL_INVITE_LINK}`;

        const cardText = buildFancyCard(
          '📢',
          'قناتنا الرسمية',
          body,
          '✨ تابعنا حتى توصلك آخر الأخبار والتحديثات!'
        );

        if (pictureUrl) {
          await sock.sendMessage(from, { image: { url: pictureUrl }, caption: cardText });
        } else {
          await sock.sendMessage(from, { text: cardText });
        }
      }

      // ================================================
      // 🎁 دفعة أدوات ومرح متنوعة
      // ================================================

      // ---- 🎲 مرح وعشوائيات ----
      else if (command === '.حظ') {
        const percent = Math.floor(Math.random() * 101);
        await sock.sendMessage(from, { text: `🍀 ✦ *حظك اليوم* ✦\n\n${percent}%` });
      } else if (command === '.نكتة') {
        const joke = jokes[Math.floor(Math.random() * jokes.length)];
        await sock.sendMessage(from, { text: `😂 ✦ *نكتة* ✦\n\n${joke}` });
      } else if (command === '.لون') {
        const color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
        await sock.sendMessage(from, { text: `🎨 ✦ *لون عشوائي* ✦\n\n${color}` });
      } else if (command === '.اسم_مستعار') {
        const nick = nicknames[Math.floor(Math.random() * nicknames.length)];
        await sock.sendMessage(from, { text: `🎭 ✦ *اسمك المستعار اليوم* ✦\n\n${nick}` });
      } else if (command === '.توقع') {
        const question = args.join(' ');
        if (!question) {
          await sock.sendMessage(from, { text: '⚠️ اسأل سؤال بعد الأمر، مثال: .توقع رح تنجح؟' });
          return;
        }
        const answers = ['أكيد! 💯', 'لأ، بعيد 🚫', 'ممكن، حاول 🤔', 'الأرجح لأ', 'أكيد رح يصير 🌟', 'الوضع غامض، جرب لاحقاً'];
        const answer = answers[Math.floor(Math.random() * answers.length)];
        await sock.sendMessage(from, { text: `🔮 ✦ *الإجابة* ✦\n\n${answer}` });
      } else if (command === '.تقييم') {
        const thing = args.join(' ');
        if (!thing) {
          await sock.sendMessage(from, { text: '⚠️ اكتب شي بعد الأمر عشان أقيّمه، مثال: .تقييم فكرتك' });
          return;
        }
        const rating = Math.floor(Math.random() * 11);
        await sock.sendMessage(from, { text: `⭐ ✦ *التقييم* ✦\n\n"${thing}"\nالتقييم: ${rating}/10` });
      } else if (command === '.توافق') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        if (!mentioned || mentioned.length < 2) {
          await sock.sendMessage(from, { text: '⚠️ اعمل منشن لشخصين، مثال: .توافق @شخص1 @شخص2' });
          return;
        }
        const percent = Math.floor(Math.random() * 101);
        await sock.sendMessage(from, {
          text: `💞 ✦ *نسبة التوافق* ✦\n\n@${mentioned[0].split('@')[0]} × @${mentioned[1].split('@')[0]}\n\n${percent}%`,
          mentions: [mentioned[0], mentioned[1]],
        });
      } else if (command === '.قرعة') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        if (!mentioned || mentioned.length < 2) {
          await sock.sendMessage(from, { text: '⚠️ اعمل منشن لشخصين أو أكتر، مثال: .قرعة @شخص1 @شخص2 @شخص3' });
          return;
        }
        const winner = mentioned[Math.floor(Math.random() * mentioned.length)];
        await sock.sendMessage(from, {
          text: `🎯 ✦ *نتيجة القرعة* ✦\n\nالفائز: @${winner.split('@')[0]}`,
          mentions: [winner],
        });
      } else if (command === '.هل_تعلم') {
        const fact = funFacts[Math.floor(Math.random() * funFacts.length)];
        await sock.sendMessage(from, { text: `💡 ✦ *هل تعلم؟* ✦\n\n${fact}` });
      }

      // ==== 🌟 بنك المحتوى الجديد: 90 أمر (اقتباسات/معلومات/عبارات/فأل وشخصية/أسئلة كسر جليد) — دخول واحد لكلهم ====
      else if (newContentBank[command]) {
        const bank = newContentBank[command];
        const pick = bank[Math.floor(Math.random() * bank.length)];
        await sock.sendMessage(from, { text: pick });
      }

      // ==== 🧰 أدوات جديدة بمنطق حقيقي (رياضيات/نصوص/تحويلات) — دخول واحد لكلهم ====
      else if (mathUtilCommands[command]) {
        const result = mathUtilCommands[command](args);
        await sock.sendMessage(from, { text: result });
      }

      // ==== 🎮 ألعاب سريعة جديدة (نتيجة فورية عشوائية) — دخول واحد لكلهم ====
      else if (quickGameCommands[command]) {
        const result = quickGameCommands[command]();
        await sock.sendMessage(from, { text: result });
      }

      // ==== 🌟 دفعة ثانية: بنك محتوى إضافي (50 أمر) ====
      else if (newContentBank2[command]) {
        const bank2 = newContentBank2[command];
        const pick2 = bank2[Math.floor(Math.random() * bank2.length)];
        await sock.sendMessage(from, { text: pick2 });
      }

      // ==== 🧰 دفعة ثانية: أدوات حقيقية إضافية (20 أمر) ====
      else if (mathUtilCommands2[command]) {
        const result2 = mathUtilCommands2[command](args);
        await sock.sendMessage(from, { text: result2 });
      }

      // ==== 🎮 دفعة ثانية: ألعاب سريعة إضافية (15 أمر) ====
      else if (quickGameCommands2[command]) {
        const result3 = quickGameCommands2[command]();
        await sock.sendMessage(from, { text: result3 });
      }

      else if (command === '.تحدي_اليوم') {
        const dare = dailyDares[Math.floor(Math.random() * dailyDares.length)];
        await sock.sendMessage(from, { text: `🔥 ✦ *تحدي اليوم* ✦\n\n${dare}\n\nقبلت التحدي؟ 😏` });
      } else if (command === '.عجلة_الحظ') {
        const wheelPrizes = ['🎉 ربحت! يوم حظك اليوم', '😅 ولا شي، حظ أوفر', '🏆 أنت بطل اليوم!', '🍀 حظك جاي قريب', '😂 دور تاني بكرا', '⭐ يوم مميز إلك'];
        const prize = wheelPrizes[Math.floor(Math.random() * wheelPrizes.length)];
        await sock.sendMessage(from, { text: `🎡 ✦ *عجلة الحظ بتلف...* ✦\n\n${prize}` });
      } else if (command === '.رقم_الحظ') {
        const guessArg = args[0];
        if (!guessArg || !/^\d+$/.test(guessArg) || +guessArg < 1 || +guessArg > 10) {
          await sock.sendMessage(from, { text: '⚠️ خمن رقم من 1 لـ 10، مثال: .رقم_الحظ 7' });
          return;
        }
        const guess = parseInt(guessArg, 10);
        const secret = Math.floor(Math.random() * 10) + 1;
        if (guess === secret) {
          addPoints(sender, 15);
          await sock.sendMessage(from, {
            text: `🎯 ✦ *صح التخمين!* ✦\nالرقم كان *${secret}*\n+15 نقطة! 🎉\n\n💰 رصيدك الحالي: ${getPoints(sender)}`,
          });
        } else {
          await sock.sendMessage(from, { text: `❌ ✦ *غلط!* ✦\nالرقم كان *${secret}*، جرب مرة ثانية 🍀` });
        }
      } else if (command === '.مين_احتمال') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        const question = args.join(' ');
        if (!question) {
          await sock.sendMessage(from, { text: '⚠️ اكتب سؤال، مثال: .مين_احتمال ينام بالصف' });
          return;
        }
        try {
          const groupMeta = await sock.groupMetadata(from);
          const realMembers = groupMeta.participants.filter((p) => p.id !== sock.user.id);
          if (realMembers.length === 0) {
            await sock.sendMessage(from, { text: '⚠️ ما لقيت أعضاء بالقروب.' });
            return;
          }
          const picked = realMembers[Math.floor(Math.random() * realMembers.length)];
          await sock.sendMessage(from, {
            text: `🤔 ✦ *مين احتمال ${question}؟* ✦\n\n👉 @${picked.id.split('@')[0]}`,
            mentions: [picked.id],
          });
        } catch (e) {
          await sock.sendMessage(from, { text: '⚠️ صار خطأ، جرب مرة ثانية.' });
        }
      } else if (command === '.اختر_عشوائي') {
        const query = args.join(' ');
        const options = query.split(',').map((s) => s.trim()).filter(Boolean);
        if (options.length < 2) {
          await sock.sendMessage(from, {
            text: '⚠️ اكتب خيارات مفصولة بفاصلة، مثال: .اختر_عشوائي بيتزا, برجر, مندي',
          });
          return;
        }
        const choice = options[Math.floor(Math.random() * options.length)];
        await sock.sendMessage(from, { text: `🎯 ✦ *الاختيار* ✦\n\n${choice}` });
      }

      // ---- 🔧 أدوات نصية ----
      else if (command === '.عكس') {
        const txt = args.join(' ');
        if (!txt) {
          await sock.sendMessage(from, { text: '⚠️ اكتب نص بعد الأمر.' });
          return;
        }
        await sock.sendMessage(from, { text: `🔁 ${txt.split('').reverse().join('')}` });
      } else if (command === '.تشفير') {
        const txt = args.join(' ');
        if (!txt) {
          await sock.sendMessage(from, { text: '⚠️ اكتب نص بعد الأمر.' });
          return;
        }
        const encoded = Buffer.from(txt, 'utf8').toString('base64');
        await sock.sendMessage(from, { text: `🔐 ✦ *النص المشفر* ✦\n\n${encoded}` });
      } else if (command === '.فك_تشفير') {
        const txt = args.join(' ');
        if (!txt) {
          await sock.sendMessage(from, { text: '⚠️ اكتب النص المشفر بعد الأمر.' });
          return;
        }
        try {
          const decoded = Buffer.from(txt, 'base64').toString('utf8');
          await sock.sendMessage(from, { text: `🔓 ✦ *النص الأصلي* ✦\n\n${decoded}` });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ النص مش بصيغة تشفير صحيحة.' });
        }
      } else if (command === '.مورس') {
        const txt = args.join(' ').toUpperCase();
        if (!txt) {
          await sock.sendMessage(from, { text: '⚠️ اكتب نص إنجليزي بعد الأمر.' });
          return;
        }
        const morse = txt
          .split('')
          .map((ch) => (ch === ' ' ? '/' : morseMap[ch] || ch))
          .join(' ');
        await sock.sendMessage(from, { text: `📡 ✦ *شفرة مورس* ✦\n\n${morse}` });
      } else if (command === '.عد_الاحرف') {
        const txt = args.join(' ');
        if (!txt) {
          await sock.sendMessage(from, { text: '⚠️ اكتب نص بعد الأمر.' });
          return;
        }
        const chars = txt.replace(/\s/g, '').length;
        const words = txt.trim().split(/\s+/).length;
        await sock.sendMessage(from, {
          text: `📏 ✦ *إحصائيات النص* ✦\n\nعدد الأحرف: ${chars}\nعدد الكلمات: ${words}`,
        });
      }

      // ---- 🔢 تحويلات وحسابات ----
      else if (command === '.عمر') {
        const birthYear = parseInt(args[0], 10);
        if (!birthYear || birthYear < 1900 || birthYear > new Date().getFullYear()) {
          await sock.sendMessage(from, { text: '⚠️ اكتب سنة ميلاد صحيحة، مثال: .عمر 2000' });
          return;
        }
        const age = new Date().getFullYear() - birthYear;
        await sock.sendMessage(from, { text: `🎂 ✦ *عمرك تقريباً* ✦\n\n${age} سنة` });
      } else if (command === '.يوم') {
        const dateStr = args[0];
        const date = new Date(dateStr);
        if (!dateStr || isNaN(date.getTime())) {
          await sock.sendMessage(from, { text: '⚠️ اكتب تاريخ صحيح، مثال: .يوم 2026-08-04' });
          return;
        }
        const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
        await sock.sendMessage(from, { text: `📅 ✦ *يوم الأسبوع* ✦\n\n${days[date.getDay()]}` });
      } else if (command === '.تحويل_طول') {
        const value = parseFloat(args[0]);
        const fromUnit = args[1];
        const toUnit = args[2];
        const units = { cm: 0.01, m: 1, km: 1000, mile: 1609.34, ft: 0.3048, inch: 0.0254 };
        if (isNaN(value) || !units[fromUnit] || !units[toUnit]) {
          await sock.sendMessage(from, {
            text: '⚠️ الصيغة: .تحويل_طول <قيمة> <من> <إلى>\nالوحدات: cm, m, km, mile, ft, inch\nمثال: .تحويل_طول 5 km mile',
          });
          return;
        }
        const result = (value * units[fromUnit]) / units[toUnit];
        await sock.sendMessage(from, {
          text: `📐 ✦ *تحويل الطول* ✦\n\n${value} ${fromUnit} = ${result.toFixed(3)} ${toUnit}`,
        });
      } else if (command === '.تحويل_وزن') {
        const value = parseFloat(args[0]);
        const fromUnit = args[1];
        const toUnit = args[2];
        const units = { g: 1, kg: 1000, lb: 453.592, oz: 28.3495 };
        if (isNaN(value) || !units[fromUnit] || !units[toUnit]) {
          await sock.sendMessage(from, {
            text: '⚠️ الصيغة: .تحويل_وزن <قيمة> <من> <إلى>\nالوحدات: g, kg, lb, oz\nمثال: .تحويل_وزن 10 kg lb',
          });
          return;
        }
        const result = (value * units[fromUnit]) / units[toUnit];
        await sock.sendMessage(from, {
          text: `⚖️ ✦ *تحويل الوزن* ✦\n\n${value} ${fromUnit} = ${result.toFixed(3)} ${toUnit}`,
        });
      } else if (command === '.تحويل_حرارة') {
        const value = parseFloat(args[0]);
        const unit = args[1]?.toLowerCase();
        if (isNaN(value) || (unit !== 'c' && unit !== 'f')) {
          await sock.sendMessage(from, {
            text: '⚠️ الصيغة: .تحويل_حرارة <قيمة> <c أو f>\nمثال: .تحويل_حرارة 30 c',
          });
          return;
        }
        let result, resultUnit;
        if (unit === 'c') {
          result = (value * 9) / 5 + 32;
          resultUnit = 'F';
        } else {
          result = ((value - 32) * 5) / 9;
          resultUnit = 'C';
        }
        await sock.sendMessage(from, {
          text: `🌡 ✦ *تحويل الحرارة* ✦\n\n${value}°${unit.toUpperCase()} = ${result.toFixed(1)}°${resultUnit}`,
        });
      }

      // ---- 🗳 تصويت وتفاعل ----
      // ملاحظة: لازم نستثني حالة تصويت المافيا النهاري، وإلا هالأمر رح ياخد الرسالة قبل ما توصل لمعالج المافيا تحت
      else if (command === '.تصويت' && !(isGroup && mafiaGames[from] && mafiaGames[from].phase === 'day')) {
        const matches = [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
        if (matches.length < 3) {
          await sock.sendMessage(from, {
            text: '⚠️ الصيغة: .تصويت "السؤال" "خيار1" "خيار2"\nمثال: .تصويت "وين نتغدى؟" "بيتزا" "برجر"',
          });
          return;
        }
        const [question, ...options] = matches;
        try {
          await sock.sendMessage(from, {
            poll: { name: question, values: options, selectableCount: 1 },
          });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ ما قدرت أنشئ التصويت.' });
        }
      }

      // ---- ⏰ تذكير شخصي ----
      // ==== ⏰ تذكير لمرة وحدة، محفوظ بملف (ما يضيع لو البوت أعاد التشغيل) ====
      else if (command === '.تذكير') {
        const minutes = parseFloat(args[0]);
        const reminderText = args.slice(1).join(' ');
        if (isNaN(minutes) || minutes <= 0 || !reminderText) {
          await sock.sendMessage(from, {
            text: '⚠️ الصيغة: .تذكير <دقائق> <النص>\nمثال: .تذكير 10 موعد الاجتماع\n\nللتذكير اليومي المتكرر: .تذكير_يومي <الساعة> <الدقيقة> <النص>\nلعرض تذكيراتك: .تذكيراتي\nلإلغاء واحد: .الغاء_تذكير <الرقم>',
          });
          return;
        }
        if (minutes > 43200) {
          await sock.sendMessage(from, { text: '⚠️ الحد الأقصى 43200 دقيقة (30 يوم).' });
          return;
        }
        const reminder = {
          id: nextReminderId++,
          chatJid: from,
          text: reminderText,
          dueAt: Date.now() + minutes * 60000,
          recurring: null,
          createdBy: sender,
        };
        reminders.push(reminder);
        saveReminders();
        scheduleReminder(sock, reminder);
        await sock.sendMessage(from, {
          text: `⏰ ✦ *تم ضبط التذكير رقم ${reminder.id}* ✦\nرح فكرك بعد ${minutes} دقيقة.`,
        });
      }

      // ==== ⏰ تذكير يومي متكرر بساعة ودقيقة محددة (زي تذكير موعد دواء أو صلاة قيام) ====
      else if (command === '.تذكير_يومي') {
        const hour = parseInt(args[0], 10);
        const minute = parseInt(args[1], 10);
        const reminderText = args.slice(2).join(' ');
        if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59 || !reminderText) {
          await sock.sendMessage(from, {
            text: '⚠️ الصيغة: .تذكير_يومي <الساعة 0-23> <الدقيقة 0-59> <النص>\nمثال: .تذكير_يومي 21 30 وقت المذاكرة',
          });
          return;
        }
        const now = new Date();
        let due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
        if (due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1); // لو الوقت فات اليوم، نبدأ بكرة
        const reminder = {
          id: nextReminderId++,
          chatJid: from,
          text: reminderText,
          dueAt: due.getTime(),
          recurring: 'daily',
          createdBy: sender,
        };
        reminders.push(reminder);
        saveReminders();
        scheduleReminder(sock, reminder);
        await sock.sendMessage(from, {
          text: `🔁 ✦ *تم ضبط تذكير يومي رقم ${reminder.id}* ✦\nرح يجيك كل يوم الساعة ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}.`,
        });
      }

      // ==== ⏰ عرض كل التذكيرات النشطة اللي أنشأها الشخص بهالمحادثة ====
      else if (command === '.تذكيراتي') {
        const mine = reminders.filter((r) => r.createdBy === sender && r.chatJid === from);
        if (mine.length === 0) {
          await sock.sendMessage(from, { text: '📋 ما عندك تذكيرات نشطة حالياً.' });
        } else {
          const list = mine
            .map((r) => {
              const dueDate = new Date(r.dueAt);
              const timeStr = dueDate.toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
              const tag = r.recurring === 'daily' ? ' 🔁 يومي' : '';
              return `#${r.id} — ${r.text}\n   🕐 ${timeStr}${tag}`;
            })
            .join('\n\n');
          await sock.sendMessage(from, { text: `📋 ✦ *تذكيراتك النشطة* ✦\n\n${list}\n\nلإلغاء أي واحد: .الغاء_تذكير <الرقم>` });
        }
      }

      // ==== ⏰ إلغاء تذكير برقمه ====
      else if (command === '.الغاء_تذكير') {
        const id = parseInt(args[0], 10);
        const target = reminders.find((r) => r.id === id && r.createdBy === sender);
        if (!target) {
          await sock.sendMessage(from, { text: '⚠️ ما لقيت تذكير بهاد الرقم يخصك. تأكد من الرقم بـ .تذكيراتي' });
          return;
        }
        reminders = reminders.filter((r) => r.id !== id);
        saveReminders();
        await sock.sendMessage(from, { text: `✅ تم إلغاء التذكير #${id}.` });
      }

      // ==== 🎮 سؤال ثقافي ====
      else if (command === '.سؤال') {
        const random = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
        quizGames[from] = { answer: random.a.toLowerCase().trim() };
        await sock.sendMessage(from, {
          text: `🧠 ✦ *سؤال ثقافي* ✦\n\n${random.q}\n\nاكتب إجابتك مباشرة!`,
        });
      }

      // ==== 🎮 تحدي حجر - ورق - مقص بين شخصين (مع لاعب افتراضي لو ما رد الطرف التاني) ====
      else if (command === '.تحدي') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        if (!mentioned || mentioned.length === 0) {
          await sock.sendMessage(from, { text: '⚠️ اعمل منشن للشخص اللي بدك تتحداه، مثال: .تحدي @شخص' });
          return;
        }
        const opponent = mentioned[0];
        if (opponent === sender) {
          await sock.sendMessage(from, { text: '⚠️ ما تقدر تتحدى نفسك 😄' });
          return;
        }

        const challengeObj = { challenger: sender, opponent, choices: {}, virtualSide: null };
        rpsChallenges[from] = challengeObj;

        await sock.sendMessage(from, {
          text:
            `╔═══════════════╗\n` +
            `   ⚔️ *تحدي حجر - ورق - مقص* ⚔️\n` +
            `╚═══════════════╝\n\n` +
            `🥊 @${sender.split('@')[0]} تحدى @${opponent.split('@')[0]}!\n\n` +
            `📝 كل واحد فيكم يكتب:\n` +
            `.اختر حجر  |  .اختر ورق  |  .اختر مقص\n\n` +
            `⏰ لو ما رد الطرف التاني خلال 45 ثانية، رح يلعب معاك *لاعب افتراضي* 🤖`,
          mentions: [sender, opponent],
        });

        // ==== ⏰ لو ما رد أحد الطرفين خلال 45 ثانية، لاعب افتراضي يكمّل مكانه ====
        setTimeout(async () => {
          if (rpsChallenges[from] !== challengeObj) return; // اتحلت مسبقاً أو تحدي جديد بلش

          const missingSide = !challengeObj.choices[challengeObj.challenger]
            ? 'challenger'
            : !challengeObj.choices[challengeObj.opponent]
            ? 'opponent'
            : null;

          if (!missingSide) return; // الاثنين جاوبوا أصلاً

          const rpsOptions = ['حجر', 'ورق', 'مقص'];
          const virtualChoice = rpsOptions[Math.floor(Math.random() * rpsOptions.length)];
          challengeObj.virtualSide = missingSide;
          challengeObj.choices[challengeObj[missingSide]] = virtualChoice;

          await resolveRpsChallenge(sock, from, challengeObj);
        }, 45000);
      } else if (command === '.اختر') {
        const choice = args[0];
        if (!['حجر', 'ورق', 'مقص'].includes(choice)) {
          await sock.sendMessage(from, { text: '⚠️ اختيارك لازم يكون: حجر أو ورق أو مقص' });
          return;
        }

        const challenge = rpsChallenges[from];
        if (!challenge || (sender !== challenge.challenger && sender !== challenge.opponent)) {
          await sock.sendMessage(from, { text: '⚠️ ما في تحدي شغال إلك حالياً. ابدأ واحد بـ .تحدي @شخص' });
          return;
        }

        challenge.choices[sender] = choice;

        if (challenge.choices[challenge.challenger] && challenge.choices[challenge.opponent]) {
          await resolveRpsChallenge(sock, from, challenge);
        } else {
          await sock.sendMessage(from, { text: `✅ تم تسجيل اختيارك، بانتظار الطرف التاني... (أو 45 ثانية ويلعب لاعب افتراضي 🤖)` });
        }
      }

      // ==== ⭕❌ بدء لعبة اكس أو (Tic-Tac-Toe) بين شخصين ====
      // ==== 🔤 بدء لعبة سلسلة الكلمات: أي حدا بالقروب يقدر يشارك، أول واحد يجاوب صح ياخذ النقطة وتكمل السلسلة ====
      else if (command === '.سلسلة_كلمات' || command === '.سلسلة') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (wordChainGames[from]) {
          await sock.sendMessage(from, { text: '⚠️ في لعبة سلسلة كلمات شغالة أصلاً بهاد القروب.' });
          return;
        }

        const starter = wordChainStarterBank[Math.floor(Math.random() * wordChainStarterBank.length)];
        const normalizedStarter = normalizeArabicWord(starter);
        const lastLetter = normalizedStarter.slice(-1);
        const roundId = Date.now();

        wordChainGames[from] = {
          lastLetter,
          usedWords: new Set([normalizedStarter]),
          round: 1,
          scores: {},
          roundId,
        };

        await sock.sendMessage(from, {
          text: buildFancyCard(
            '🔤',
            'سلسلة الكلمات',
            `🎬 كلمة البداية: *${starter}*\n\n` +
              `📝 اكتب كلمة عربية تبلش بحرف *"${lastLetter}"*، وما تكون انكتبت قبل هيك بنفس الجولة\n` +
              `⚡ أول واحد يجاوب صح ياخذ النقطة وتكمل السلسلة عليه\n` +
              `⏰ عندك ${WORD_CHAIN_ROUND_TIMEOUT_MS / 1000} ثانية بين كل كلمة والتانية، وإلا بتنتهي اللعبة`,
            '🛑 لإنهاء اللعبة بأي وقت: .انهاء_سلسلة'
          ),
        });

        scheduleWordChainTimeout(sock, from, roundId);
      }

      // ==== 🛑 إنهاء لعبة سلسلة الكلمات يدوياً ====
      else if (command === '.انهاء_سلسلة') {
        if (!wordChainGames[from]) {
          await sock.sendMessage(from, { text: '⚠️ ما في لعبة سلسلة كلمات شغالة هون.' });
          return;
        }
        await endWordChainGame(sock, from, `🛑 @${sender.split('@')[0]} أنهى اللعبة.`);
      }

      else if (command === '.اكس_او' || command === '.xo') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        if (!mentioned || mentioned.length === 0) {
          await sock.sendMessage(from, { text: '⚠️ اعمل منشن للشخص اللي بدك تلعب وياه، مثال: .اكس_او @شخص' });
          return;
        }
        const opponent = mentioned[0];
        if (pointsKey(opponent) === pointsKey(sender)) {
          await sock.sendMessage(from, { text: '⚠️ ما تقدر تلعب مع نفسك 😄' });
          return;
        }
        if (xoGames[from]) {
          await sock.sendMessage(from, { text: '⚠️ في لعبة اكس أو شغالة أصلاً بهاد القروب، خلصوها الأول (أو استنى دقيقتين وبتنتهي تلقائياً).' });
          return;
        }

        xoGames[from] = {
          p1: sender,
          p2: opponent,
          board: Array(9).fill(null),
          turn: 'p1',
          symbols: { p1: '❌', p2: '⭕' },
          lastMoveAt: Date.now(),
        };

        await sendXoBoard(sock, from, xoGames[from], `🎮 @${sender.split('@')[0]} تحدى @${opponent.split('@')[0]} بلعبة اكس أو!\n\n`);

        // ==== ⏰ لو ضل القروب من غير حركة لدقيقتين، اللعبة تنتهي تلقائياً حتى ما تعلق ====
        setTimeout(() => {
          const g = xoGames[from];
          if (g && Date.now() - g.lastMoveAt >= 119000) {
            delete xoGames[from];
            sock.sendMessage(from, { text: '⏰ انتهت لعبة اكس أو تلقائياً بسبب عدم الحركة لمدة طويلة.' }).catch(() => {});
          }
        }, 120000);
      }

      // ==== ⭕❌ حركة بلعبة اكس أو ====
      else if (command === '.حرك') {
        const pos = parseInt(args[0], 10);
        await applyXoMove(sock, from, sender, pos);
      }

      // ==== 🎯 بدء لعبة المشنقة — تخمين حروف كلمة سرية جماعياً ====
      else if (command === '.مشنقة') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (hangmanGames[from]) {
          await sock.sendMessage(from, { text: '⚠️ في لعبة مشنقة شغالة أصلاً بهاد القروب. .استسلام_مشنقة لإنهائها.' });
          return;
        }

        const categories = Object.keys(hangmanWordBank);
        const category = categories[Math.floor(Math.random() * categories.length)];
        const words = hangmanWordBank[category];
        const word = words[Math.floor(Math.random() * words.length)];

        hangmanGames[from] = {
          word,
          category,
          guessed: new Set(),
          wrong: new Set(),
          maxWrong: HANGMAN_MAX_WRONG,
          lastActionAt: Date.now(),
          contributors: {},
        };

        await sendHangmanBoard(sock, from, hangmanGames[from], '🎮 ✦ *لعبة مشنقة جديدة بلشت!* ✦\n\n');

        // ==== ⏰ لو ضل القروب من غير تخمين لـ 3 دقايق، اللعبة تنتهي تلقائياً حتى ما تعلق ====
        setTimeout(() => {
          const g = hangmanGames[from];
          if (g && Date.now() - g.lastActionAt >= 179000) {
            delete hangmanGames[from];
            sock.sendMessage(from, {
              text: buildFancyCard('⏰', 'انتهت لعبة المشنقة', `ما حدا خمّن لفترة طويلة.\n🔤 الكلمة كانت: *${g.word}*`),
            }).catch(() => {});
          }
        }, 180000);
      }

      // ==== 🏳️ استسلام من لعبة المشنقة الحالية ====
      else if (command === '.استسلام_مشنقة') {
        const game = hangmanGames[from];
        if (!game) {
          await sock.sendMessage(from, { text: '⚠️ ما في لعبة مشنقة شغالة هون.' });
          return;
        }
        delete hangmanGames[from];
        await sock.sendMessage(from, {
          text: buildFancyCard('🏳️', 'انتهت لعبة المشنقة', `🔤 الكلمة كانت: *${game.word}*`),
        });
      }

      // ==== ⚔️ بدء مبارزة 1 ضد 1 بنقاط حياة — أسئلة صعبة بدل الهجوم العشوائي ====
      else if (command === '.مبارزة') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        if (!mentioned || mentioned.length === 0) {
          await sock.sendMessage(from, { text: '⚠️ اعمل منشن للشخص اللي بدك تباريه، مثال: .مبارزة @شخص' });
          return;
        }
        const opponent = mentioned[0];
        if (opponent === sender) {
          await sock.sendMessage(from, { text: '⚠️ ما تقدر تبارز نفسك 😄' });
          return;
        }
        if (duels[from]) {
          await sock.sendMessage(from, { text: '⚠️ في مبارزة شغالة أصلاً بهاد القروب، خلصوها الأول.' });
          return;
        }
        duels[from] = {
          p1: sender,
          p2: opponent,
          hp: { p1: DUEL_MAX_HP, p2: DUEL_MAX_HP },
          gold: { p1: 0, p2: 0 },
          turn: 'p1',
          heals: { p1: 0, p2: 0 },
          shielded: { p1: false, p2: false },
          fullShielded: { p1: false, p2: false },
          doubleAttack: { p1: false, p2: false },
          pendingPierce: { p1: false, p2: false },
          cursed: { p1: false, p2: false },
          dodge: { p1: false, p2: false },
          revive: { p1: false, p2: false },
          pendingAttackBonus: { p1: 0, p2: 0 },
          warnings: { p1: 0, p2: 0 },
          pendingQuestion: null,
          actionReady: { p1: false, p2: false },
          roundId: 0,
        };
        await sock.sendMessage(from, {
          text:
            `╔═══════════════╗\n` +
            `   ⚔️💀 *مبارزة ملحمية* 💀⚔️\n` +
            `╚═══════════════╝\n\n` +
            `@${sender.split('@')[0]} ⚡ VS ⚡ @${opponent.split('@')[0]}\n\n` +
            `❤️ كل واحد عندو *${DUEL_MAX_HP}* نقطة حياة\n` +
            `🧠 جاوب صح على الأسئلة الصعبة حتى تكسب ذهب وتفتح حركة!\n` +
            `🎯 بعد كل جواب صح، رح تختار: *.هجوم* ⚔️ / *.دفاع* 🛡️ / *.شفاء* 💚\n` +
            `🛒 استخدم الذهب بمتجر المعركة (.متجر_المعركة) حتى تشتري أسلحة وسحر\n\n` +
            `⚠️ لعب منظم بالدور — أي حد يلعب بدوره الأول مرة إنذار، وتاني مرة بيطلع من المبارزة تلقائياً (خسارة فورية).`,
          mentions: [sender, opponent],
        });
        await announceDuelRound(sock, from);
      }

      // ==== 🛒 متجر المعركة: يشتغل بس أثناء مبارزة نشطة ====
      else if (command === '.متجر_المعركة') {
        const duel = duels[from];
        if (!duel || (sender !== duel.p1 && sender !== duel.p2)) {
          await sock.sendMessage(from, { text: '⚠️ ما إلك مبارزة نشطة هلق. ابدأ وحدة بـ .مبارزة @شخص' });
          return;
        }
        const mySlot = sender === duel.p1 ? 'p1' : 'p2';
        const list = renderDuelShop(duel, mySlot);
        await sock.sendMessage(from, {
          text:
            `🛒 ✦ *متجر المعركة* ✦\n${list}\n` +
            `🪙 ذهبك الحالي: *${duel.gold[mySlot]}*\n` +
            `حياتك: ${renderHpBar(duel.hp[mySlot])} ${duel.hp[mySlot]}/${DUEL_MAX_HP}\n\n` +
            `للشراء: .شراء_معركة <المعرف>`,
        });
      }

      // ==== 🛍️ شراء غرض من متجر المعركة (يشتغل بأي وقت، مو لازم يكون دورك) ====
      else if (command === '.شراء_معركة') {
        const duel = duels[from];
        if (!duel || (sender !== duel.p1 && sender !== duel.p2)) {
          await sock.sendMessage(from, { text: '⚠️ ما إلك مبارزة نشطة هلق.' });
          return;
        }
        const item = findDuelItem(args[0]);
        if (!item) {
          await sock.sendMessage(from, { text: '⚠️ ما لقيت هيك غرض. اكتب .متجر_المعركة لتشوف الأغراض المتاحة.' });
          return;
        }
        const mySlot = sender === duel.p1 ? 'p1' : 'p2';
        const oppSlot = mySlot === 'p1' ? 'p2' : 'p1';
        const myJid = duel[mySlot];
        const oppJid = duel[oppSlot];
        if (duel.gold[mySlot] < item.price) {
          await sock.sendMessage(from, { text: `❌ ذهبك مش كافي! بدك ${item.price} 🪙 وعندك ${duel.gold[mySlot]} بس.` });
          return;
        }
        duel.gold[mySlot] -= item.price;

        if (item.type === 'attack') {
          duel.pendingAttackBonus[mySlot] += item.value;
          await sock.sendMessage(from, {
            text: `✅ @${myJid.split('@')[0]} اشترى ${item.name}! هجمتك الجاية رح تكون أقوى بـ+${item.value} ⚔️\n\n🪙 ذهبك المتبقي: ${duel.gold[mySlot]}`,
            mentions: [myJid],
          });
        } else if (item.type === 'shield') {
          duel.shielded[mySlot] = true;
          await sock.sendMessage(from, {
            text: `✅ @${myJid.split('@')[0]} اشترى ${item.name}! 🛡️ محمي من نص ضرر أول هجمة توصله.\n\n🪙 ذهبك المتبقي: ${duel.gold[mySlot]}`,
            mentions: [myJid],
          });
        } else if (item.type === 'heal') {
          duel.hp[mySlot] = Math.min(DUEL_MAX_HP, duel.hp[mySlot] + item.value);
          await sock.sendMessage(from, {
            text: `✅ @${myJid.split('@')[0]} اشترى ${item.name}! 💚 +${item.value} ❤️ (الحياة الآن: ${duel.hp[mySlot]})\n\n🪙 ذهبك المتبقي: ${duel.gold[mySlot]}`,
            mentions: [myJid],
          });
        } else if (item.type === 'steal') {
          const stolen = Math.min(item.value, duel.gold[oppSlot]);
          duel.gold[oppSlot] -= stolen;
          duel.gold[mySlot] += stolen;
          await sock.sendMessage(from, {
            text: `✅ @${myJid.split('@')[0]} استخدم ${item.name}! 🕵️ سرق ${stolen} 🪙 من @${oppJid.split('@')[0]}\n\n🪙 ذهبك الحالي: ${duel.gold[mySlot]}`,
            mentions: [myJid, oppJid],
          });
        } else if (item.type === 'dodge') {
          duel.dodge[mySlot] = true;
          await sock.sendMessage(from, {
            text: `✅ @${myJid.split('@')[0]} اشترى ${item.name}! 🌀 جاهز تتفادى الهجمة الجاية بالكامل.\n\n🪙 ذهبك المتبقي: ${duel.gold[mySlot]}`,
            mentions: [myJid],
          });
        } else if (item.type === 'revive') {
          duel.revive[mySlot] = true;
          await sock.sendMessage(from, {
            text: `✅ @${myJid.split('@')[0]} اشترى ${item.name}! 💍 لو جتك هجمة قاتلة رح تنجو بنقطة حياة واحدة.\n\n🪙 ذهبك المتبقي: ${duel.gold[mySlot]}`,
            mentions: [myJid],
          });
        } else if (item.type === 'goldboost') {
          duel.gold[mySlot] += item.value;
          await sock.sendMessage(from, {
            text: `✅ @${myJid.split('@')[0]} اشترى ${item.name}! ⚡ +${item.value} ذهب فوري.\n\n🪙 ذهبك الحالي: ${duel.gold[mySlot]}`,
            mentions: [myJid],
          });
        } else if (item.type === 'pierceattack') {
          duel.pendingAttackBonus[mySlot] += item.value;
          duel.pendingPierce[mySlot] = true;
          await sock.sendMessage(from, {
            text: `✅ @${myJid.split('@')[0]} اشترى ${item.name}! هجمتك الجاية بتخترق أي درع أو تفادي +${item.value} ⚔️🏹\n\n🪙 ذهبك المتبقي: ${duel.gold[mySlot]}`,
            mentions: [myJid],
          });
        } else if (item.type === 'doubleattack') {
          duel.doubleAttack[mySlot] = true;
          await sock.sendMessage(from, {
            text: `✅ @${myJid.split('@')[0]} اشترى ${item.name}! هجمتك الجاية بتضرب مرتين 🗡️🗡️\n\n🪙 ذهبك المتبقي: ${duel.gold[mySlot]}`,
            mentions: [myJid],
          });
        } else if (item.type === 'curse') {
          duel.cursed[oppSlot] = true;
          await sock.sendMessage(from, {
            text: `✅ @${myJid.split('@')[0]} استخدم ${item.name}! 💀 لعن @${oppJid.split('@')[0]}، هجمتو الجاية رح تضعف للنص.\n\n🪙 ذهبك المتبقي: ${duel.gold[mySlot]}`,
            mentions: [myJid, oppJid],
          });
        } else if (item.type === 'fullshield') {
          duel.fullShielded[mySlot] = true;
          await sock.sendMessage(from, {
            text: `✅ @${myJid.split('@')[0]} اشترى ${item.name}! 🧿 محمي بالكامل من أول هجمة توصله (صفر ضرر).\n\n🪙 ذهبك المتبقي: ${duel.gold[mySlot]}`,
            mentions: [myJid],
          });
        } else if (item.type === 'legendary') {
          duel.hp[mySlot] = DUEL_MAX_HP;
          duel.fullShielded[mySlot] = true;
          await sock.sendMessage(from, {
            text: `👑✨ @${myJid.split('@')[0]} استخدم ${item.name}! شفاء كامل فوري + حماية كاملة من الهجمة الجاية!\n\nحياته الآن: ${renderHpBar(duel.hp[mySlot])} ${duel.hp[mySlot]}/${DUEL_MAX_HP}\n🪙 ذهبك المتبقي: ${duel.gold[mySlot]}`,
            mentions: [myJid],
          });
        }
      }

      // ==== ⚔️ حركة المبارزة بعد إجابة صحيحة: هجوم / دفاع / شفاء (اختيار واحد من ثلاثة) ====
      else if (['.هجوم', '.دفاع', '.شفاء'].includes(command) && duels[from] && (sender === duels[from].p1 || sender === duels[from].p2)) {
        const duel = duels[from];
        const isP1 = sender === duel.p1;
        const mySlot = isP1 ? 'p1' : 'p2';
        const oppSlot = isP1 ? 'p2' : 'p1';
        const myJid = isP1 ? duel.p1 : duel.p2;
        const oppJid = isP1 ? duel.p2 : duel.p1;

        // ---- 🚨 غش: لعب بغير دوره ----
        if (duel.turn !== mySlot) {
          duel.warnings[mySlot] = (duel.warnings[mySlot] || 0) + 1;
          if (duel.warnings[mySlot] >= 2) {
            delete duels[from];
            const newTotal = addPoints(oppJid, 20);
            await sock.sendMessage(from, {
              text:
                `🚫 ✦ *طرد من المبارزة!* ✦\n@${myJid.split('@')[0]} لعب بره دوره أكتر من مرة (غش) وطُرد تلقائياً.\n\n` +
                `🏆 الفوز لـ @${oppJid.split('@')[0]}! (+20 نقطة، المجموع: ${newTotal})`,
              mentions: [myJid, oppJid],
            });
          } else {
            await sock.sendMessage(from, {
              text: `⚠️ ✦ *إنذار!* ✦ @${myJid.split('@')[0]} مش دورك هلق! دور @${oppJid.split('@')[0]}.\nلو صار هيك مرة ثانية رح تُطرد من المبارزة تلقائياً.`,
              mentions: [myJid, oppJid],
            });
          }
          return;
        }

        // ---- 🔒 دورك، بس لسا ما فتحت حركة (لازم تجاوب صح على السؤال الأول) ----
        if (!duel.actionReady[mySlot]) {
          await sock.sendMessage(from, {
            text: `🔒 لسا ما فتحت حركة! جاوب صح على السؤال المطروح الأول حتى تقدر تستخدم .هجوم/.دفاع/.شفاء.`,
          });
          return;
        }

        // ---- ⚔️ هجوم ----
        if (command === '.هجوم') {
          let damage = Math.floor(Math.random() * 2) + 1; // 1-2 ضرر أساسي (الحياة صارت من 10)
          damage += duel.pendingAttackBonus[mySlot] || 0;
          duel.pendingAttackBonus[mySlot] = 0;

          let note = '';
          // 💀 لو أنت ملعون، هجمتك بتضعف للنص
          if (duel.cursed[mySlot]) {
            damage = Math.max(0, Math.floor(damage / 2));
            duel.cursed[mySlot] = false;
            note += ' 💀(هجمتك أضعف بسبب اللعنة)';
          }

          const pierce = !!duel.pendingPierce[mySlot];
          duel.pendingPierce[mySlot] = false;

          // 🗡️🗡️ ضربة مزدوجة: تضاعف الضرر
          if (duel.doubleAttack[mySlot]) {
            damage *= 2;
            duel.doubleAttack[mySlot] = false;
            note += ' 🗡️🗡️(ضربة مزدوجة!)';
          }

          if (pierce) {
            note += ' 🏹(اخترقت كل الدروع والتفادي!)';
          } else if (duel.dodge[oppSlot]) {
            damage = 0;
            duel.dodge[oppSlot] = false;
            note += ' 🌀 (تفادى الهجمة بالكامل بتعويذة الصد!)';
          } else if (duel.fullShielded[oppSlot]) {
            damage = 0;
            duel.fullShielded[oppSlot] = false;
            note += ' 🧿 (التميمة صدت الهجمة بالكامل!)';
          } else if (duel.shielded[oppSlot]) {
            damage = Math.floor(damage / 2);
            duel.shielded[oppSlot] = false;
            note += ' 🛡️ (الدرع خفف الضرر للنص)';
          }

          let newHp = duel.hp[oppSlot] - damage;
          let reviveNote = '';
          if (newHp <= 0 && duel.revive[oppSlot]) {
            newHp = 1;
            duel.revive[oppSlot] = false;
            reviveNote = `\n😱 @${oppJid.split('@')[0]} نجا بأعجوبة بخاتم الإحياء! بقيتله نقطة حياة واحدة بس!`;
          }
          duel.hp[oppSlot] = Math.max(0, newHp);

          const goldWon = Math.floor(Math.random() * 11) + 15; // 15-25 ذهب إضافي على الهجمة الناجحة
          duel.gold[mySlot] += goldWon;
          duel.actionReady[mySlot] = false;

          await sock.sendMessage(from, {
            text:
              `⚔️ ✦ *هجوم!* ✦${note}\n@${myJid.split('@')[0]} 💥 -${damage} ❤️ على @${oppJid.split('@')[0]}${reviveNote}\n🪙 +${goldWon} ذهب لـ @${myJid.split('@')[0]}\n\n` +
              `👤 @${myJid.split('@')[0]}: ${renderHpBar(duel.hp[mySlot])} ${duel.hp[mySlot]}\n` +
              `👤 @${oppJid.split('@')[0]}: ${renderHpBar(duel.hp[oppSlot])} ${duel.hp[oppSlot]}`,
            mentions: [myJid, oppJid],
          });

          const ended = await checkDuelEnd(sock, from, myJid, oppJid, oppSlot);
          if (!ended) {
            duel.turn = oppSlot;
            await announceDuelRound(sock, from);
          }
        }

        // ---- 🛡️ دفاع ----
        else if (command === '.دفاع') {
          duel.shielded[mySlot] = true;
          duel.actionReady[mySlot] = false;
          await sock.sendMessage(from, {
            text: `🛡️ ✦ @${myJid.split('@')[0]} اتخذ وضعية دفاع! الهجمة الجاية عليه بتضعف للنص (إلا إذا كانت متفادية بالكامل).`,
            mentions: [myJid],
          });
          duel.turn = oppSlot;
          await announceDuelRound(sock, from);
        }

        // ---- 💚 شفاء ----
        else if (command === '.شفاء') {
          if (duel.heals[mySlot] >= DUEL_MAX_HEALS) {
            await sock.sendMessage(from, {
              text: `⚠️ استهلكت كل مرات الشفاء المجانية (${DUEL_MAX_HEALS}). اختار .هجوم أو .دفاع، أو اشتري جرعة من .متجر_المعركة وبعدها اختار حركة تانية.`,
            });
            return; // الحركة لسا مفتوحة، بيقدر يختار غيرها
          }
          const healAmount = Math.floor(Math.random() * 2) + 1; // 1-2
          duel.heals[mySlot]++;
          duel.hp[mySlot] = Math.min(DUEL_MAX_HP, duel.hp[mySlot] + healAmount);
          duel.actionReady[mySlot] = false;
          await sock.sendMessage(from, {
            text:
              `💚 ✦ @${myJid.split('@')[0]} استشفى! +${healAmount} ❤️ (باقيلو ${DUEL_MAX_HEALS - duel.heals[mySlot]} مرات شفاء مجانية)\n\n` +
              `حياته الآن: ${renderHpBar(duel.hp[mySlot])} ${duel.hp[mySlot]}`,
            mentions: [myJid],
          });
          duel.turn = oppSlot;
          await announceDuelRound(sock, from);
        }
      }

      // ==== 💀 بدء حرب جماعية (Battle Royale) بالقروب — للأدمن/مالك البوت بس. يقبل مدة انضمام مخصصة: .بدء_حرب <ثواني> ====
      else if (command === '.بدء_حرب') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ الحرب الجماعية متاحة بس جوا القروبات.' });
          return;
        }
        const allowed = await isAdminOrOwner(sock, from, sender);
        if (!allowed) {
          await sock.sendMessage(from, { text: '⚠️ بس الأدمن أو مالك البوت يقدر يبدأ حرب جماعية.' });
          return;
        }
        if (wars[from]) {
          await sock.sendMessage(from, { text: '⚠️ في حرب شغالة أصلاً بهاد القروب. لإلغائها: .الغاء_حرب' });
          return;
        }
        const customSecs = parseInt(args[0], 10);
        const joinWindowMs = (!isNaN(customSecs) && customSecs >= 20 && customSecs <= 180) ? customSecs * 1000 : WAR_JOIN_WINDOW_MS;
        wars[from] = {
          phase: 'joining',
          participants: {},
          joinEndsAt: Date.now() + joinWindowMs,
          startedBy: sender,
          reminderSent: false,
        };
        await sock.sendMessage(from, {
          text:
            `╔═══════════════╗\n` +
            `   💀⚔️ *حرب جماعية بدأت* ⚔️💀\n` +
            `╚═══════════════╝\n\n` +
            `🙋 كل واحد بده يشارك يكتب: *.انضم*\n` +
            `⏰ عندكم *${Math.round(joinWindowMs / 1000)}* ثانية للانضمام!\n\n` +
            `⚔️ بعد ما تبدأ الحرب، اهجم على أي مشارك بـ .هجوم @شخص\n` +
            `❤️ كل واحد عندو ${WAR_MAX_HP} نقطة حياة، آخر ناجي بيفوز بجائزة ضخمة!\n` +
            `📋 .حالة_الحرب لتشوف مين منضم | ❌ .الغاء_حرب لإلغائها (أدمن بس)\n\n` +
            `⚠️ لعب منظم: أي غش (هجوم بره الدور المسموح/كولداون، هجوم على شخص مش بالحرب) إنذار وبعده طرد تلقائي من الحرب.`,
        });
      }

      // ==== ❌ إلغاء حرب جماعية بمرحلة الانضمام — للأدمن/مالك البوت بس ====
      else if (command === '.الغاء_حرب') {
        if (!isGroup || !wars[from]) {
          await sock.sendMessage(from, { text: '⚠️ ما في حرب شغالة حالياً.' });
          return;
        }
        if (wars[from].phase !== 'joining') {
          await sock.sendMessage(from, { text: '⚠️ الحرب بلشت فعلياً، ما ممكن تتلغى هلق.' });
          return;
        }
        const allowed = await isAdminOrOwner(sock, from, sender);
        if (!allowed) {
          await sock.sendMessage(from, { text: '⚠️ بس الأدمن أو مالك البوت يقدر يلغي الحرب.' });
          return;
        }
        delete wars[from];
        await sock.sendMessage(from, { text: `❌ @${sender.split('@')[0]} ألغى الحرب الجماعية.`, mentions: [sender] });
      }

      // ==== 💀 انضمام لحرب جماعية شغالة ====
      else if (command === '.انضم') {
        if (!isGroup) return;
        const war = wars[from];
        if (!war || war.phase !== 'joining') {
          await sock.sendMessage(from, { text: '⚠️ ما في حرب مفتوحة للانضمام حالياً. الأدمن يبدأ وحدة بـ .بدء_حرب' });
          return;
        }
        if (Date.now() > war.joinEndsAt) {
          await sock.sendMessage(from, { text: '⚠️ خلصت مهلة الانضمام!' });
          return;
        }
        const key = pointsKey(sender);
        if (war.participants[key]) {
          await sock.sendMessage(from, { text: '⚠️ أنت منضم أصلاً!' });
          return;
        }
        war.participants[key] = { jid: sender, hp: WAR_MAX_HP, warnings: 0, lastAttackAt: 0 };
        const joinedList = Object.values(war.participants).map((p) => `⚔️ @${p.jid.split('@')[0]}`).join('\n');
        const secsLeft = Math.max(0, Math.ceil((war.joinEndsAt - Date.now()) / 1000));
        await sock.sendMessage(from, {
          text:
            `✅ @${sender.split('@')[0]} انضم للحرب! (${Object.keys(war.participants).length} مشاركين لهلق)\n\n` +
            `${joinedList}\n\n⏰ باقي ${secsLeft} ثانية للانضمام`,
          mentions: Object.values(war.participants).map((p) => p.jid),
        });
      }

      // ==== 💀 هجوم بالحرب الجماعية على مشارك محدد ====
      else if (command === '.هجوم' && isGroup && wars[from]) {
        const war = wars[from];
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        const targetJid = mentioned && mentioned.length > 0 ? mentioned[0] : null;
        const myKey = pointsKey(sender);
        const me = war.participants[myKey];

        // لسا بمرحلة الانضمام، ما في هجوم لسا (المجدول التلقائي بيبدأ الحرب فوراً بعد ما تخلص المهلة)
        if (war.phase === 'joining') {
          await sock.sendMessage(from, { text: '⚠️ لسا بمرحلة الانضمام، اصبر شوي.' });
          return;
        }

        if (!me || me.hp <= 0) {
          await sock.sendMessage(from, { text: '⚠️ أنت مش مشارك بالحرب (أو خرجت منها).' });
          return;
        }
        if (!targetJid) {
          await sock.sendMessage(from, { text: '⚠️ حدد هدفك، مثال: .هجوم @شخص' });
          return;
        }
        const targetKey = pointsKey(targetJid);
        const target = war.participants[targetKey];

        // ---- 🚨 غش: هجوم على شخص مش بالحرب، أو على نفسه، أو قبل الكولداون ----
        const now = Date.now();
        const cheated =
          targetKey === myKey ||
          !target ||
          target.hp <= 0 ||
          now - me.lastAttackAt < WAR_ATTACK_COOLDOWN_MS;

        if (cheated) {
          me.warnings = (me.warnings || 0) + 1;
          if (me.warnings >= 2) {
            me.hp = 0;
            await sock.sendMessage(from, {
              text: `🚫 ✦ *طرد من الحرب!* ✦\n@${sender.split('@')[0]} كرر مخالفة قواعد الهجوم (غش) وطُرد تلقائياً من الحرب.`,
              mentions: [sender],
            });
          } else {
            const reason = targetKey === myKey
              ? 'ما تقدر تهجم على نفسك'
              : !target || target.hp <= 0
              ? 'هدفك مش مشارك أو خارج الحرب أصلاً'
              : `لازم تستنى ${Math.ceil((WAR_ATTACK_COOLDOWN_MS - (now - me.lastAttackAt)) / 1000)} ثانية قبل الهجمة الجاية`;
            await sock.sendMessage(from, {
              text: `⚠️ ✦ *إنذار!* ✦ ${reason}.\nلو تكرر رح تُطرد من الحرب تلقائياً.`,
            });
          }
        } else {
          me.lastAttackAt = now;
          const damage = Math.floor(Math.random() * 2) + 1; // 1-2 (الحياة صارت من 10)
          target.hp = Math.max(0, target.hp - damage);
          let resultText =
            `⚔️ @${sender.split('@')[0]} هجم على @${targetJid.split('@')[0]}! 💥 -${damage} ❤️\n` +
            `${renderHpBar(target.hp, WAR_MAX_HP)} ${target.hp}/${WAR_MAX_HP}`;
          if (target.hp <= 0) {
            resultText += `\n💀 @${targetJid.split('@')[0]} قُضي عليه وخرج من الحرب!`;
          }
          await sock.sendMessage(from, { text: resultText, mentions: [sender, targetJid] });
        }

        // ---- 🏆 فحص إذا خلصت الحرب (ناجي واحد بس) ----
        const alive = Object.values(war.participants).filter((p) => p.hp > 0);
        if (war.phase === 'active' && alive.length <= 1) {
          delete wars[from];
          if (alive.length === 1) {
            const winnerJid = alive[0].jid;
            const totalParticipants = Object.keys(war.participants).length;
            const prize = Math.max(50, totalParticipants * 20);
            const newTotal = addPoints(winnerJid, prize);
            await sock.sendMessage(from, {
              text:
                `╔═══════════╗\n   🏆👑 *انتهت الحرب الجماعية!* 👑🏆\n╚═══════════╝\n\n` +
                `الفائز الأخير: @${winnerJid.split('@')[0]} 💀⚔️\n\n🎁 +${prize} نقطة (المجموع: ${newTotal})`,
              mentions: [winnerJid],
            });
          } else {
            await sock.sendMessage(from, { text: `🏁 انتهت الحرب بدون ناجين! تعادل غريب 🤷` });
          }
        }
      }

      // ==== 💀 حالة الحرب الجماعية الحالية ====
      else if (command === '.حالة_الحرب') {
        if (!isGroup || !wars[from]) {
          await sock.sendMessage(from, { text: '⚠️ ما في حرب شغالة حالياً.' });
          return;
        }
        const war = wars[from];
        if (war.phase === 'joining') {
          const list = Object.values(war.participants).map((p) => `⚔️ @${p.jid.split('@')[0]}`).join('\n') || 'ولا حدا لسا';
          await sock.sendMessage(from, {
            text: `📋 ✦ *مرحلة الانضمام* ✦\n\nالمنضمين:\n${list}\n\n⏰ باقي: ${Math.max(0, Math.ceil((war.joinEndsAt - Date.now()) / 1000))} ثانية`,
            mentions: Object.values(war.participants).map((p) => p.jid),
          });
        } else {
          const alive = Object.values(war.participants).filter((p) => p.hp > 0);
          const list = alive.map((p) => `👤 @${p.jid.split('@')[0]}\n${renderHpBar(p.hp, WAR_MAX_HP)} ${p.hp}/${WAR_MAX_HP}`).join('\n');
          await sock.sendMessage(from, {
            text: `📋 ✦ *الحرب شغالة* ✦\n\nالناجين (${alive.length}):\n${list}`,
            mentions: alive.map((p) => p.jid),
          });
        }
      }

      // ==== 🏰 برج التحدي الأسطوري: تسلق أطباق البرج، اقتل الوحوش، اجمع غنيمة، أو انسحب بأمان قبل ما تخسر كل شي ====
      else if (command === '.برج_التحدي') {
        const key = pointsKey(sender);
        let run = towerRuns[key];

        if (!run) {
          run = { floor: 1, hp: TOWER_BASE_HP, maxHp: TOWER_BASE_HP, loot: 0 };
          towerRuns[key] = run;
          const monster = towerMonsterFor(run.floor);
          await sock.sendMessage(from, {
            text:
              `╔═══════════════╗\n   🏰 *برج التحدي الأسطوري* 🏰\n╚═══════════════╝\n\n` +
              `بدأت التسلق! ❤️ حياتك: ${run.hp}/${run.maxHp}\n\n` +
              `🚪 الطابق ${run.floor}: واجهت ${monster.name} (❤️ ${monster.hp})\n\n` +
              `⚔️ اكتب .برج_التحدي تاني عشان تهاجمه!\n💰 .انسحاب_البرج للخروج الآمن وتاخد الغنيمة يلي جمعتها.\n\n` +
              `⚠️ لو متّ جوا البرج، بتخسر كل الغنيمة يلي ما نزلتها!`,
          });
          return;
        }

        if (!run.currentMonster) run.currentMonster = towerMonsterFor(run.floor);
        const monster = run.currentMonster;

        // ---- ضربتك للوحش ----
        const myDamage = Math.floor(Math.random() * 5) + 3; // 3-7
        monster.hp -= myDamage;
        let text = `⚔️ ضربت ${monster.name} بـ${myDamage} ❤️ (باقيلو ${Math.max(0, monster.hp)})\n`;

        if (monster.hp <= 0) {
          const lootGained = 15 + run.floor * 5 + (run.floor % 10 === 0 ? 100 : 0);
          run.loot += lootGained;
          const bossNote = run.floor % 10 === 0 ? '\n👑🔥 قتلت زعيم البرج! غنيمة ضخمة!' : '';
          text += `💀 قضيت على ${monster.name}!${bossNote}\n💰 +${lootGained} نقطة غنيمة (المجموع الحالي: ${run.loot})\n\n`;
          run.floor++;
          run.currentMonster = towerMonsterFor(run.floor);
          text += `🚪 صعدت للطابق ${run.floor}! واجهت ${run.currentMonster.name} (❤️ ${run.currentMonster.hp})`;
        } else {
          // ---- رد الوحش عليك ----
          const monsterDamage = Math.floor(Math.random() * (monster.maxDmg - monster.minDmg + 1)) + monster.minDmg;
          run.hp -= monsterDamage;
          text += `${monster.name} رد عليك بـ${monsterDamage} ❤️ (حياتك الآن: ${Math.max(0, run.hp)}/${run.maxHp})`;

          if (run.hp <= 0) {
            delete towerRuns[key];
            await sock.sendMessage(from, {
              text: `${text}\n\n💀☠️ ✦ *متت جوا البرج!* ✦ ☠️💀\nخسرت كل الغنيمة يلي كنت جمعتها (كانت ${run.loot} نقطة). وصلت للطابق ${run.floor}.\n\nجرب تاني بـ .برج_التحدي`,
            });
            return;
          }
        }

        text += `\n\n💰 غنيمتك المجمّعة: ${run.loot} نقطة (لسا ما نزلتها)\n.انسحاب_البرج للخروج الآمن`;
        await sock.sendMessage(from, { text });
      }

      // ==== 🏰 انسحاب آمن من البرج: تحفظ كل الغنيمة كنقاط فعلية ====
      else if (command === '.انسحاب_البرج') {
        const key = pointsKey(sender);
        const run = towerRuns[key];
        if (!run) {
          await sock.sendMessage(from, { text: '⚠️ ما إلك تسلّق شغال بالبرج حالياً. ابدأ وحدة بـ .برج_التحدي' });
          return;
        }
        delete towerRuns[key];
        if (run.loot <= 0) {
          await sock.sendMessage(from, { text: `🏃 انسحبت من البرج بالطابق ${run.floor} بدون غنيمة تُذكر.` });
          return;
        }
        const newTotal = addPoints(sender, run.loot);
        await sock.sendMessage(from, {
          text: `🏃💰 ✦ *انسحبت بأمان!* ✦\nوصلت للطابق ${run.floor} وجمعت *${run.loot}* نقطة غنيمة!\n\n🏅 المجموع الآن: ${newTotal}`,
        });
      }

      // ==== 🎡 عجلة الحظ الملكية: راهن بنقاطك، دور العجلة، واكسب مضاعفات (أو خسر كل شي) ====
      else if (command === '.عجلة_الحظ') {
        const betAmount = parseInt((args[0] || '').trim(), 10);
        if (!betAmount || betAmount <= 0) {
          await sock.sendMessage(from, { text: '⚠️ حدد رهانك، مثال: .عجلة_الحظ 100' });
          return;
        }
        const myPoints = getPoints(sender);
        if (myPoints < betAmount) {
          await sock.sendMessage(from, { text: `❌ نقاطك مش كافية! معك *${myPoints}* بس وبدك تراهن بـ*${betAmount}*.` });
          return;
        }
        spendPoints(sender, betAmount);
        const result = spinWheel();
        const winnings = Math.round(betAmount * result.mult);
        const newTotal = addPoints(sender, winnings);
        const netChange = winnings - betAmount;
        const netText = netChange >= 0 ? `+${netChange} 🎉` : `${netChange} 📉`;

        await sock.sendMessage(from, {
          text:
            `╔═══════════════╗\n   🎡 *عجلة الحظ الملكية* 🎡\n╚═══════════════╝\n\n` +
            `💰 راهنت بـ: ${betAmount} نقطة\n\n` +
            `🎯 النتيجة: *${result.label}*\n\n` +
            `📊 رجعلك: ${winnings} نقطة (صافي: ${netText})\n🏅 رصيدك الآن: ${newTotal}`,
        });
      }

      // ==== 🕌 إدارة تذكير الصلاة (أدمن القروب أو مالك البوت) ====
      else if (command === '.اضف_صلاة') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        const prayerName = args[0];
        const time = args[1];
        if (!prayerName || !time || !/^\d{1,2}:\d{2}$/.test(time)) {
          await sock.sendMessage(from, {
            text: '⚠️ الصيغة الصحيحة: .اضف_صلاة الفجر 05:10',
          });
          return;
        }
        if (!prayerTimes[from]) prayerTimes[from] = {};
        prayerTimes[from][prayerName] = time;
        saveJSON(PRAYER_FILE, prayerTimes);
        await sock.sendMessage(from, { text: `✅ ✦ *تم ضبط تذكير صلاة ${prayerName} الساعة ${time}* ✦` });
      } else if (command === '.حذف_صلاة') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        const prayerName = args[0];
        if (prayerTimes[from] && prayerTimes[from][prayerName]) {
          delete prayerTimes[from][prayerName];
          saveJSON(PRAYER_FILE, prayerTimes);
          await sock.sendMessage(from, { text: `✅ تم حذف تذكير صلاة ${prayerName}.` });
        } else {
          await sock.sendMessage(from, { text: '⚠️ ما في تذكير محفوظ بهاد الاسم.' });
        }
      } else if (command === '.صلوات') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        const schedule = prayerTimes[from];
        if (!schedule || Object.keys(schedule).length === 0) {
          await sock.sendMessage(from, { text: '📋 ما في أوقات صلاة مضبوطة لهاد القروب.' });
        } else {
          const list = Object.entries(schedule)
            .map(([name, time]) => `🕌 ${name}: ${time}`)
            .join('\n');
          await sock.sendMessage(from, { text: `╭──✦ *أوقات الصلاة* ✦──╮\n\n${list}\n\n╰──────────╯` });
        }
      }

      // ==== 🌙 تفعيل/تعطيل تذكير الصلاة على النبي كل 30 دقيقة ====
      else if (command === '.تفعيل_الصلاة_على_النبي') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        if (!salawatGroups.includes(from)) {
          salawatGroups.push(from);
          saveJSON(SALAWAT_FILE, salawatGroups);
        }
        await sock.sendMessage(from, {
          text: '🌙 ✦ *تم تفعيل تذكير الصلاة على النبي كل 30 دقيقة لهاد القروب.* ✦',
        });
      } else if (command === '.تعطيل_الصلاة_على_النبي') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        salawatGroups = salawatGroups.filter((id) => id !== from);
        saveJSON(SALAWAT_FILE, salawatGroups);
        await sock.sendMessage(from, { text: '✅ تم تعطيل تذكير الصلاة على النبي لهاد القروب.' });
      }

      // ==== 📿 ذكر فوري عند الطلب ====
      else if (command === '.اذكار' || command === '.ذكر') {
        const phrase = azkarPhrases[Math.floor(Math.random() * azkarPhrases.length)];
        await sock.sendMessage(from, {
          text: `╭──✦ 📿 *ذكر* 📿 ✦──╮\n\n${phrase}\n\n╰──────────╯`,
        });
      }

      // ==== 📿 تفعيل/تعطيل تذكير الأذكار العامة كل 30 دقيقة ====
      else if (command === '.تفعيل_الاذكار') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        if (!azkarGroups.includes(from)) {
          azkarGroups.push(from);
          saveJSON(AZKAR_FILE, azkarGroups);
        }
        await sock.sendMessage(from, {
          text: '📿 ✦ *تم تفعيل تذكير الأذكار كل 30 دقيقة لهاد القروب.* ✦',
        });
      } else if (command === '.تعطيل_الاذكار') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        azkarGroups = azkarGroups.filter((id) => id !== from);
        saveJSON(AZKAR_FILE, azkarGroups);
        await sock.sendMessage(from, { text: '✅ تم تعطيل تذكير الأذكار لهاد القروب.' });
      }

      // ==== تحويل صورة لملصق (باستخدام ffmpeg) ====
      // ==== 🖼️/🎞️ إنشاء ستيكر: صورة = ثابت، فيديو/GIF قصير = متحرك — أبعاد 512×512 مربعة بالضبط بلا أي تمطيط ====
      else if (command === '.ستيكر' || command === '.sticker') {
        const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
        const imageMsg = msg.message.imageMessage || quoted?.imageMessage;
        const videoMsg = msg.message.videoMessage || quoted?.videoMessage;

        if (!imageMsg && !videoMsg) {
          await sock.sendMessage(from, {
            text: '⚠️ لازم ترسل صورة أو فيديو/GIF قصير (أو ترد عليهم) مع الأمر .ستيكر\n📌 صورة ← ستيكر ثابت | فيديو/GIF ← ستيكر متحرك',
          });
          return;
        }

        const isVideo = !!videoMsg;
        const stream = await downloadContentFromMessage(isVideo ? videoMsg : imageMsg, isVideo ? 'video' : 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }

        const inputPath = `/data/data/com.termux/files/home/mybot/temp_in_${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`;
        const outputPath = `/data/data/com.termux/files/home/mybot/temp_out_${Date.now()}.webp`;
        fs.writeFileSync(inputPath, buffer);

        try {
          if (isVideo) {
            // ---- 🎞️ ستيكر متحرك: أول 6 ثواني بس، وأبعاد 512×512 مربعة تماماً (scale+pad بدل التمطيط المباشر) ----
            await execPromise(
              `ffmpeg -y -i "${inputPath}" -t 6 -vf "fps=15,scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" -vcodec libwebp -lossless 0 -q:v 60 -preset default -loop 0 -an -vsync 0 -s 512:512 "${outputPath}"`
            );

            // ---- واتساب بيرفض الستيكرات المتحركة الكبيرة، فلو الحجم زاد عن 1 ميجا نضغطها أكتر تلقائياً ----
            let sizeCheck = fs.statSync(outputPath).size;
            if (sizeCheck > 1000 * 1024) {
              await execPromise(
                `ffmpeg -y -i "${inputPath}" -t 5 -vf "fps=10,scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" -vcodec libwebp -lossless 0 -q:v 40 -preset default -loop 0 -an -vsync 0 -s 512:512 "${outputPath}"`
              );
            }
          } else {
            // ---- 🖼️ ستيكر ثابت: أبعاد 512×512 مربعة تماماً، بدون ما تتمطط الصورة الأصلية ----
            await execPromise(
              `ffmpeg -y -i "${inputPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" -vcodec libwebp -lossless 0 -q:v 80 -preset default -loop 0 -an -vsync 0 -s 512:512 "${outputPath}"`
            );
          }

          const webpBuffer = fs.readFileSync(outputPath);
          await sock.sendMessage(from, { sticker: webpBuffer });
        } finally {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        }
      }

      // ==== 🎧 استخراج الصوت من فيديو (باستخدام ffmpeg) ====
      else if (command === '.استخراج_صوت' || command === '.صوت_من_فيديو') {
        const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
        const videoMsg = msg.message.videoMessage || quoted?.videoMessage;

        if (!videoMsg) {
          await sock.sendMessage(from, {
            text: '⚠️ لازم ترسل فيديو أو ترد على فيديو مع الأمر .استخراج_صوت',
          });
          return;
        }

        const stream = await downloadContentFromMessage(videoMsg, 'video');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }

        const inputPath = `/data/data/com.termux/files/home/mybot/temp_vid_${Date.now()}.mp4`;
        const outputPath = `/data/data/com.termux/files/home/mybot/temp_aud_${Date.now()}.mp3`;
        fs.writeFileSync(inputPath, buffer);

        try {
          // ---- -vn: تجاهل الفيديو، بس استخرج الصوت وحوّله mp3 بجودة كويسة ----
          await execPromise(`ffmpeg -y -i "${inputPath}" -vn -acodec libmp3lame -q:a 2 "${outputPath}"`);

          if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
            await sock.sendMessage(from, { text: '⚠️ الفيديو ما فيه صوت أصلاً، ما قدرت استخرج شي.' });
            return;
          }

          await sock.sendMessage(from, {
            audio: fs.readFileSync(outputPath),
            mimetype: 'audio/mpeg',
            ptt: false, // ملف MP3 عادي، مش رسالة صوتية بالميكروفون
          });
        } catch (e) {
          console.error('خطأ باستخراج الصوت:', e.message);
          await sock.sendMessage(from, { text: '⚠️ صار خطأ أثناء استخراج الصوت، جرب فيديو تاني.' });
        } finally {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        }
      }

      // ==== تحويل ستيكر لصورة (إذا ثابت) أو فيديو (إذا متحرك) ====
      else if (command === '.صورة' || command === '.استخراج') {
        const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
        const stickerMsg = msg.message.stickerMessage || quoted?.stickerMessage;

        if (!stickerMsg) {
          await sock.sendMessage(from, { text: '⚠️ لازم ترد على ستيكر مع الأمر .صورة' });
          return;
        }

        const stream = await downloadContentFromMessage(stickerMsg, 'sticker');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }

        const isAnimated = !!stickerMsg.isAnimated;
        const inputPath = `/data/data/com.termux/files/home/mybot/temp_stk_${Date.now()}.webp`;
        fs.writeFileSync(inputPath, buffer);

        try {
          if (isAnimated) {
            // ==== ستيكر متحرك ⇦ فيديو mp4 (عبر فك تشفير الفريمات بـ libwebp، مش ffmpeg مباشرة) ====
            const outputPath = `/data/data/com.termux/files/home/mybot/temp_stk_${Date.now()}.mp4`;
            await convertAnimatedWebpToMp4(inputPath, outputPath);
            const videoBuffer = fs.readFileSync(outputPath);
            await sock.sendMessage(from, { video: videoBuffer, caption: '🎬 ✦ *تم تحويل الستيكر لفيديو* ✦' });
            fs.unlinkSync(outputPath);
          } else {
            // ==== ستيكر ثابت ⇦ صورة png، بأبعاد مربعة 512×512 وخلفية شفافة (نفس منطق إنشاء الستيكر بالضبط) ====
            const outputPath = `/data/data/com.termux/files/home/mybot/temp_stk_${Date.now()}.png`;
            await execPromise(
              `ffmpeg -y -i "${inputPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" "${outputPath}"`,
              { timeout: 60000 }
            );
            const imageBuffer = fs.readFileSync(outputPath);
            await sock.sendMessage(from, { image: imageBuffer, caption: '🖼️ ✦ *تم تحويل الستيكر لصورة* ✦' });
            fs.unlinkSync(outputPath);
          }
        } catch (err) {
          console.log('❌ خطأ بتحويل الستيكر:', err.message, err.stderr || '');
          await sock.sendMessage(from, { text: `❌ صار خطأ أثناء تحويل الستيكر.\n📋 ${err.message}` });
        } finally {
          fs.unlinkSync(inputPath);
        }
      }

      // ==== 🎵 جلب أغنية من يوتيوب (باستخدام yt-dlp) — نتيجة وحدة بس، تنزيل مباشر ====
      else if (command === '.تشغيل' || command === '.شغل' || command === '.play') {
        const query = args.join(' ');
        if (!query) {
          await sock.sendMessage(from, { text: '⚠️ اكتب اسم الأغنية بعد الأمر، مثال: .تشغيل Fairouz' });
          return;
        }

        const safeQuery = query.replace(/["]/g, '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();

        // ==== 🔗 لو المستخدم بعت رابط يوتيوب مباشرة، منزله بدون بحث (نتيجة واحدة أكيدة) ====
        if (safeQuery.startsWith('http')) {
          try {
            await sock.sendMessage(from, { text: '🔍 عم أجيب معلومات الرابط...' });
            const { stdout: infoJsonLine } = await execFilePromise(
              'yt-dlp',
              ['--dump-json', '--no-playlist', safeQuery],
              { timeout: 60000, maxBuffer: 20 * 1024 * 1024 }
            );
            const result = JSON.parse(infoJsonLine.trim().split('\n')[0]);
            await downloadAndSendSong(sock, from, result);
          } catch (err) {
            console.log('❌ خطأ بتنزيل من رابط مباشر:', err.stderr || err.message);
            await sock.sendMessage(from, { text: '❌ ما قدرت أنزل من هاد الرابط، تأكد إنه رابط يوتيوب صحيح.' });
          }
          return;
        }

        try {
          await sock.sendMessage(from, { text: `🔍 عم أدور على *${query}*...` });

          const { stdout: infoJsonLines } = await execFilePromise(
            'yt-dlp',
            ['--dump-json', '--no-playlist', `ytsearch${SONG_SEARCH_COUNT}:${safeQuery}`],
            { timeout: 60000, maxBuffer: 20 * 1024 * 1024 }
          );

          const results = infoJsonLines
            .trim()
            .split('\n')
            .filter((line) => line.trim())
            .map((line) => {
              try {
                return JSON.parse(line);
              } catch (e) {
                return null;
              }
            })
            .filter(Boolean);

          if (results.length === 0) {
            await sock.sendMessage(from, { text: '❌ ما لقيت نتائج لهاد البحث، جرب اسم مختلف.' });
            return;
          }

          // ==== نتيجة وحدة بس؟ ننزلها مباشرة بدون ما نتعب المستخدم يختار ====
          if (results.length === 1) {
            await downloadAndSendSong(sock, from, results[0]);
            return;
          }

          pendingSongSelections.set(from, { results, requester: sender, timestamp: Date.now() });

          const listLines = results
            .map((r, i) => {
              const dur = r.duration
                ? `${Math.floor(r.duration / 60)}:${String(Math.floor(r.duration % 60)).padStart(2, '0')}`
                : '؟؟';
              const channel = r.channel || r.uploader || 'غير معروف';
              return `*${i + 1}.* ${truncateTitle(r.title, 40)}\n     📡 ${channel} │ ⏱ ${dur}`;
            })
            .join('\n\n');

          // ==== نحاول نبني صورة فيلم-سترايب من الصور المصغّرة (اختياري، لو فشل منكمل بدونها) ====
          let filmstrip = null;
          try {
            filmstrip = await buildThumbnailFilmstrip(results.map((r) => r.thumbnail).filter(Boolean));
          } catch (e) {
            filmstrip = null;
          }

          const listText = buildFancyCard(
            '🎵',
            'نتائج البحث',
            `${listLines}`,
            `📝 رد برقم النتيجة (1-${results.length}) خلال 3 دقايق لتنزيلها`
          );

          if (filmstrip) {
            await sock.sendMessage(from, { image: filmstrip, caption: listText });
          } else {
            await sock.sendMessage(from, { text: listText });
          }
        } catch (err) {
          console.log('❌ خطأ ببحث الأغنية:', err.stderr || err.message);
          await sock.sendMessage(from, { text: '❌ صار خطأ أثناء البحث، جرب اسم مختلف.' });
        }
      }

      // ==== 🎵 اختيار المستخدم لرقم من نتائج بحث الأغنية — ينزّل بالضبط النتيجة يلي اختارها (مش نتيجة عشوائية) ====
      else if (/^\d+$/.test(command) && pendingSongSelections.has(from)) {
        const pending = pendingSongSelections.get(from);
        const expired = Date.now() - pending.timestamp > SONG_SELECTION_TIMEOUT_MS;
        if (expired) {
          pendingSongSelections.delete(from);
        } else {
          const typedNumber = parseInt(command, 10);
          if (typedNumber < 1 || typedNumber > pending.results.length) {
            await sock.sendMessage(from, { text: `⚠️ اختار رقم بين 1 و ${pending.results.length}.` });
            return;
          }
          const chosen = pending.results[typedNumber - 1];
          pendingSongSelections.delete(from);
          try {
            await downloadAndSendSong(sock, from, chosen);
          } catch (err) {
            console.log('❌ خطأ بتنزيل الأغنية المختارة:', err.message);
            await sock.sendMessage(from, { text: '❌ صار خطأ أثناء تنزيل الأغنية، جرب من جديد.' });
          }
        }
      }

      // ==== 🎬 تحميل فيديو من يوتيوب ====
      else if (command === '.فيديو' || command === '.video') {
        const query = args.join(' ');
        if (!query) {
          await sock.sendMessage(from, { text: '⚠️ اكتب اسم الفيديو أو رابطه، مثال: .فيديو قناة ناشيونال جيوغرافيك' });
          return;
        }

        const isDirectLink = query.startsWith('http');
        const searchTarget = isDirectLink ? query : `ytsearch1:${query.replace(/"/g, '')}`;

        try {
          // ==== الخطوة 1: بطاقة معلومات الفيديو ====
          const { stdout: infoJson } = await execPromise(
            `yt-dlp --dump-json --no-playlist "${searchTarget}"`,
            { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }
          );
          const info = JSON.parse(infoJson);

          const title = info.title || query;
          const channel = info.channel || info.uploader || 'غير معروف';
          const durationSec = info.duration || 0;
          const minutes = Math.floor(durationSec / 60);
          const seconds = Math.floor(durationSec % 60);
          const thumbnail = info.thumbnail;
          const url = info.webpage_url || `https://youtu.be/${info.id}`;

          // ==== تحذير لو الفيديو طويل جداً (حجم كبير مايناسب واتساب حتى بجودة واطية) ====
          if (durationSec > 1800) {
            await sock.sendMessage(from, {
              text: '⚠️ الفيديو أطول من 30 دقيقة، ممكن الحجم يكون كبير وياخذ وقت أطول أو يفشل الإرسال. جاري المحاولة على أي حال...',
            });
          }

          const caption =
            `「🎬」 *جاري تنزيل* <${title}>\n\n` +
            `┃ 📡 القناة: *${channel}*\n` +
            `┃ ⏱ المدة: *${minutes} دقيقة ${seconds} ثانية*\n` +
            `┃ 🔗 الرابط: ${url}`;

          if (thumbnail) {
            await sock.sendMessage(from, { image: { url: thumbnail }, caption });
          } else {
            await sock.sendMessage(from, { text: caption });
          }

          // ==== الخطوة 2: التنزيل الفعلي (جودة 360p عشان فيديوهات أطول تفوت بالحجم المسموح) ====
          const safeName = `video_${Date.now()}`;
          const outputTemplate = `/data/data/com.termux/files/home/mybot/${safeName}.%(ext)s`;

          await execPromise(
            `yt-dlp -f "best[height<=360][filesize<70M]/best[height<=360]/best" --max-filesize 70M -o "${outputTemplate}" "${searchTarget}"`,
            { timeout: 240000, maxBuffer: 10 * 1024 * 1024 }
          );

          // ==== إيجاد الملف الناتج (الامتداد ممكن يختلف) ====
          const files = fs.readdirSync('/data/data/com.termux/files/home/mybot').filter((f) => f.startsWith(safeName));
          if (files.length === 0) {
            await sock.sendMessage(from, {
              text: '❌ ما قدرت أنزل الفيديو (يمكن حجمه أكبر من 70 ميجا). جرب فيديو أقصر.',
            });
            return;
          }

          const finalPath = `/data/data/com.termux/files/home/mybot/${files[0]}`;

          await sock.sendMessage(from, {
            video: fs.readFileSync(finalPath),
            caption: `🎬 ${title}`,
          });

          fs.unlinkSync(finalPath);
        } catch (err) {
          console.log('❌ خطأ بتنزيل الفيديو:', err.message);
          await sock.sendMessage(from, {
            text: '❌ صار خطأ أثناء تنزيل الفيديو (يمكن الحجم كبير أو الرابط غير مدعوم)، جرب فيديو مختلف.',
          });
        }
      }

      // ==== 📌 بنترست: تحميل من رابط أو بحث بكلمة ====
      else if (command === '.بنترست' || command === '.pinterest') {
        const query = args.join(' ');
        if (!query) {
          await sock.sendMessage(from, {
            text: '⚠️ اكتب رابط بنترست أو كلمة بحث بعد الأمر.\nمثال: .بنترست قطط\nأو: .بنترست https://pin.it/xxxxx',
          });
          return;
        }

        const isDirectLink = query.startsWith('http') && (query.includes('pinterest.') || query.includes('pin.it'));

        // ==== الوضع الأول: رابط مباشر لمنشور واحد ====
        if (isDirectLink) {
          await sock.sendMessage(from, { text: '📌 جاري التحميل من بنترست...' });
          try {
            const { stdout } = await execPromise(`yt-dlp -g "${query}"`, { timeout: 60000 });
            const mediaUrl = stdout.trim().split('\n')[0];

            if (!mediaUrl) {
              await sock.sendMessage(from, { text: '❌ ما قدرت ألاقي محتوى بهاد الرابط.' });
              return;
            }

            const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(mediaUrl);
            if (isVideo) {
              await sock.sendMessage(from, { video: { url: mediaUrl }, caption: '📌 من بنترست' });
            } else {
              await sock.sendMessage(from, { image: { url: mediaUrl }, caption: '📌 من بنترست' });
            }
          } catch (err) {
            console.log('❌ خطأ بتحميل بنترست:', err.message);
            await sock.sendMessage(from, {
              text: '❌ ما قدرت أحمل من هاد الرابط، تأكد إنه رابط بنترست صحيح ومباشر لمنشور واحد.',
            });
          }
        }

        // ==== الوضع الثاني: بحث بكلمة (صورة حقيقية موثوقة، بما إن بنترست ما بيدعم السحب المباشر) ====
        else {
          try {
            await sock.sendMessage(from, {
              image: { url: `https://source.unsplash.com/600x400/?${encodeURIComponent(query)}` },
              caption: `📌 ✦ *${query}* ✦\n\n(لصورة محددة من بنترست بالذات، ابعت رابط مباشر: .بنترست https://pin.it/xxxxx)`,
            });
          } catch (e) {
            await sock.sendMessage(from, { text: '❌ ما قدرت أجيب صورة، جرب كلمة بحث مختلفة أو استخدم رابط بنترست مباشر.' });
          }
        }
      }

      // ==== 📦 .Apk <اسم التطبيق>: يدور على APKPure ويحمّل الملف مباشرة ويبعته ====
      // ==== 📦 .apk <اسم التطبيق>: يدور على صفحة بحث APKPure العامة ويحمّل رابط APK مباشر ====
      else if (command === '.apk') {
        const appName = args.join(' ').trim();
        if (!appName) {
          await sock.sendMessage(from, { text: '⚠️ اكتب اسم التطبيق بعد الأمر، مثال: .apk واتساب' });
          return;
        }

        await sock.sendMessage(from, { text: `🔍 عم أدور عن *${appName}* بـ APKPure...` });

        const apkPath = `/data/data/com.termux/files/home/mybot/temp_apk_${Date.now()}.apk`;

        try {
          // ==== الخطوة 1: نجيب صفحة نتائج البحث العامة (HTML) ونطلع أول رابط تطبيق منها ====
          const searchPageRes = await fetchWithTimeout(
            `https://apkpure.com/search?q=${encodeURIComponent(appName)}`,
            { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12)' } },
            25000
          );
          const searchHtml = await searchPageRes.text();

          // نمط رابط تطبيق بـ APKPure: /اسم-عرض/اسم.الحزمة (اسم الحزمة فيه نقطة على الأقل)
          const linkMatch = searchHtml.match(/href="\/([a-zA-Z0-9._-]+)\/([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)"/);

          if (!linkMatch) {
            console.log(
              `⚠️ .apk: ما لقيت رابط تطبيق بصفحة نتائج البحث. الحالة: ${searchPageRes.status}. بداية الصفحة:`,
              searchHtml.slice(0, 300)
            );
            await sock.sendMessage(from, {
              text: `❌ ما لقيت تطبيق باسم "${appName}" (أو تغيّر شكل صفحة APKPure). جرب اسم مختلف أو بالإنجليزي.`,
            });
            return;
          }

          const slug = linkMatch[1];
          const pkgName = linkMatch[2];
          const appTitle = slug.replace(/-/g, ' ');

          await sock.sendMessage(from, { text: `📦 لقيت *${appTitle}*\n📥 جاري التحميل، ثانية...` });

          // ==== الخطوة 2: نفتح صفحة التحميل تبع التطبيق ونطلع منها رابط الـ APK المباشر ====
          const downloadPageRes = await fetchWithTimeout(
            `https://apkpure.com/${slug}/${pkgName}/download`,
            { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12)' } },
            25000
          );
          const downloadHtml = await downloadPageRes.text();

          const directLinkMatch =
            downloadHtml.match(/href="(https:\/\/d\.apkpure\.com\/b\/(?:XAPK|APK)\/[^"]+)"/) ||
            downloadHtml.match(/data-url="(https:\/\/d\.apkpure\.com\/b\/(?:XAPK|APK)\/[^"]+)"/);

          // ==== لو ما لقينا رابط بصفحة التحميل، نجرب نمط XAPK الموحّد (هو الافتراضي حالياً بـ APKPure، مش APK) ====
          const downloadUrl = directLinkMatch
            ? directLinkMatch[1].replace(/&amp;/g, '&')
            : `https://d.apkpure.com/b/XAPK/${pkgName}?version=latest`;

          // ==== نحدد نوع الملف من الرابط نفسه (XAPK = حزمة ZIP فيها عدة APKs، APK = ملف عادي) ====
          const isXapk = /\/b\/XAPK\//i.test(downloadUrl);
          const fileExt = isXapk ? 'xapk' : 'apk';
          const finalApkPath = apkPath.replace(/\.apk$/, `.${fileExt}`);

          await execPromise(`curl -sL "${downloadUrl}" -o "${finalApkPath}" --max-time 120`, { timeout: 130000 });

          if (!fs.existsSync(finalApkPath) || fs.statSync(finalApkPath).size < 10000) {
            console.log(
              `⚠️ .apk: الملف يلي تنزل صغير/فاضي. رابط التحميل يلي جربناه: ${downloadUrl}. الحالة من صفحة التحميل: ${downloadPageRes.status}`
            );
            throw new Error('الملف يلي تنزل صغير كتير أو فاضي، على الأغلب رابط التحميل تغيّر من عند APKPure.');
          }

          const sizeBytes = fs.statSync(finalApkPath).size;
          const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);

          if (sizeBytes > 95 * 1024 * 1024) {
            fs.unlinkSync(finalApkPath);
            await sock.sendMessage(from, {
              text: `⚠️ حجم "${appTitle}" كبير كتير (${sizeMB} MB) وواتساب ممكن يرفض إرساله. جرب تطبيق أصغر أو حمّله يدوياً من apkpure.com`,
            });
            return;
          }

          await sock.sendMessage(from, {
            document: fs.readFileSync(finalApkPath),
            fileName: `${appTitle}.${fileExt}`,
            mimetype: isXapk ? 'application/octet-stream' : 'application/vnd.android.package-archive',
            caption:
              `📦 ✦ *${appTitle}* ✦\n📏 الحجم: ${sizeMB} MB\n📡 المصدر: APKPure` +
              (isXapk
                ? `\n⚠️ الملف بصيغة XAPK (حزمة فيها أكتر من APK) — لازم تطبيق زي *APKPure* أو *SAI* لتثبيته، مش مثبت أندرويد العادي.`
                : ''),
          });
          fs.unlinkSync(finalApkPath);
        } catch (err) {
          console.log('❌ خطأ بأمر .apk:', err.message);
          await sock.sendMessage(from, {
            text: `❌ ما قدرت أحمل التطبيق.\n📋 السبب: ${err.message}\n\nجرب اسم مختلف، أو ابعتلي رسالة الخطأ هاي حتى أتأكد شو صار بالضبط.`,
          });
          const apkVariant = apkPath.replace(/\.apk$/, '.apk');
          const xapkVariant = apkPath.replace(/\.apk$/, '.xapk');
          if (fs.existsSync(apkVariant)) fs.unlinkSync(apkVariant);
          if (fs.existsSync(xapkVariant)) fs.unlinkSync(xapkVariant);
        }
      }

      // ==== 🎨 .حزمة <موضوع>: يجهّز حزمة ملصقات (عدة ستيكرات) بموضوع مطلوب، عبر بحث صور Openverse (مجاني وبدون مفتاح) ====
      else if (command === '.حزمة') {
        const topic = args.join(' ').trim();
        if (!topic) {
          await sock.sendMessage(from, { text: '⚠️ اكتب موضوع الحزمة بعد الأمر، مثال: .حزمة قطط' });
          return;
        }

        const packSize = 6;
        await sock.sendMessage(from, {
          text: `🎨 ✦ *عم أجهزلك حزمة ملصقات "${topic}"* ✦\nعطيني شوي، عم أحضّر ${packSize} ملصقات...`,
        });

        if (!PEXELS_API_KEY || PEXELS_API_KEY === 'ضع_مفتاح_Pexels_هون') {
          await sock.sendMessage(from, {
            text: '⚠️ ما تحدد مفتاح Pexels API بعد. خد مفتاح مجاني من pexels.com/api وحطو بالكود (PEXELS_API_KEY).',
          });
          return;
        }

        let imageUrls = [];
        try {
          const searchRes = await fetchWithTimeout(
            `https://api.pexels.com/v1/search?query=${encodeURIComponent(topic)}&per_page=${packSize * 2}`,
            { headers: { Authorization: PEXELS_API_KEY } },
            20000
          );
          const searchData = await searchRes.json();
          if (searchData?.error || searchData?.code) {
            console.log('⚠️ .حزمة: خطأ من Pexels API:', JSON.stringify(searchData));
          }
          imageUrls = (searchData?.photos || [])
            .map((p) => p.src?.large || p.src?.original)
            .filter(Boolean)
            .slice(0, packSize);
        } catch (e) {
          console.log(`⚠️ .حزمة: فشل البحث عن صور لموضوع "${topic}":`, e.message);
        }

        if (imageUrls.length === 0) {
          await sock.sendMessage(from, {
            text: `❌ ما لقيت صور لموضوع "${topic}". جرب موضوع أوضح (بالإنجليزي أحياناً بيطلع أدق).`,
          });
          return;
        }

        let sentCount = 0;
        for (let i = 0; i < imageUrls.length; i++) {
          const stamp = `${Date.now()}_${i}`;
          const imgPath = `/data/data/com.termux/files/home/mybot/temp_pack_${stamp}.jpg`;
          const stkPath = `/data/data/com.termux/files/home/mybot/temp_pack_${stamp}.webp`;

          try {
            await execPromise(`curl -sL "${imageUrls[i]}" -o "${imgPath}" --max-time 25`, { timeout: 30000 });

            if (!fs.existsSync(imgPath) || fs.statSync(imgPath).size < 2000) {
              throw new Error('ما نزلت صورة صالحة');
            }

            await execPromise(
              `ffmpeg -y -i "${imgPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" -vcodec libwebp -lossless 0 -q:v 80 -preset default -loop 0 -an -vsync 0 -s 512:512 "${stkPath}"`,
              { timeout: 30000 }
            );

            const webpBuffer = fs.readFileSync(stkPath);
            await sock.sendMessage(from, { sticker: webpBuffer });
            sentCount++;
          } catch (e) {
            console.log(`⚠️ فشل ملصق رقم ${i + 1} بحزمة "${topic}":`, e.message);
          } finally {
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
            if (fs.existsSync(stkPath)) fs.unlinkSync(stkPath);
          }
        }

        if (sentCount === 0) {
          await sock.sendMessage(from, {
            text: `❌ ما قدرت أجهز ولا ملصق لموضوع "${topic}". جرب موضوع أوضح (بالإنجليزي أحياناً بيطلع أدق).`,
          });
        } else {
          await sock.sendMessage(from, {
            text: `✅ خلصت! بعتلك ${sentCount} من ${imageUrls.length} ملصقات لحزمة *"${topic}"* 🎉`,
          });
        }
      }

      // ==== قفل / فتح القروب (أدمن القروب أو مالك البوت) ====
      else if (command === '.قفل' || command === '.فتح') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }

        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }

        if (command === '.قفل') {
          await sock.groupSettingUpdate(from, 'announcement');
          await sock.sendMessage(from, { text: '🔒 ✦ *تم قفل القروب* ✦\nالأدمن فقط يقدر يكتب الآن.' });
        } else {
          await sock.groupSettingUpdate(from, 'not_announcement');
          await sock.sendMessage(from, { text: '🔓 ✦ *تم فتح القروب* ✦\nالجميع يقدر يكتب من جديد.' });
        }
      }

      // ==== 🚪 تفعيل/إيقاف خاصية "لازم موافقة الأدمن حتى ينضم عضو جديد بالرابط" ====
      else if (command === '.وضع_الموافقة') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        const state = (args[0] || '').trim();
        if (state !== 'تشغيل' && state !== 'ايقاف') {
          await sock.sendMessage(from, { text: '⚠️ الصيغة: .وضع_الموافقة تشغيل  أو  .وضع_الموافقة ايقاف' });
          return;
        }
        try {
          await sock.groupJoinApprovalMode(from, state === 'تشغيل' ? 'on' : 'off');
          await sock.sendMessage(from, {
            text:
              state === 'تشغيل'
                ? '🚪✅ ✦ *تم تفعيل موافقة الأدمن!* ✦\nأي شخص جديد بدو ينضم بالرابط، طلبه رح يستنى موافقتك بـ .قبول_عضو أو .رفض_عضو'
                : '🚪 ✦ *تم إيقاف موافقة الأدمن.* ✦\nأي حدا معه الرابط بينضم مباشرة.',
          });
        } catch (e) {
          console.log('⚠️ خطأ بأمر .وضع_الموافقة:', e.message);
          await sock.sendMessage(from, { text: '❌ ما قدرت أغيّر الإعداد. تأكد إنه البوت أدمن بالقروب.' });
        }
      }

      // ==== ✅❌ قبول أو رفض طلب انضمام شخص معلّق (بعد ما تكون فعّلت .وضع_الموافقة تشغيل) ====
      else if (command === '.قبول_عضو' || command === '.رفض_عضو') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }

        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        let targetJid = mentioned && mentioned.length > 0 ? mentioned[0] : null;
        if (!targetJid) {
          const digits = (args[0] || '').replace(/[^\d]/g, '');
          if (digits) targetJid = `${digits}@s.whatsapp.net`;
        }
        if (!targetJid) {
          await sock.sendMessage(from, {
            text: `⚠️ حدد الشخص بمنشن أو رقمه، مثال: ${command} @شخص  أو  ${command} 9665xxxxxxxx`,
          });
          return;
        }

        try {
          const action = command === '.قبول_عضو' ? 'approve' : 'reject';
          await sock.groupRequestParticipants(from, [targetJid], action);
          await sock.sendMessage(from, {
            text:
              action === 'approve'
                ? `✅ ✦ *تم قبول طلب انضمام* @${targetJid.split('@')[0]}` 
                : `❌ ✦ *تم رفض طلب انضمام* @${targetJid.split('@')[0]}`,
            mentions: [targetJid],
          });
        } catch (e) {
          console.log(`⚠️ خطأ بأمر ${command}:`, e.message);
          await sock.sendMessage(from, {
            text: '❌ ما قدرت أنفذ. تأكد إنه فيه فعلاً طلب انضمام معلّق بهاد الرقم، وإنه البوت أدمن بالقروب.',
          });
        }
      }

      // ==== حظر / رفع حظر مستخدم من استخدام البوت (أدمن القروب أو مالك البوت) ====
      else if (command === '.حظر' || command === '.رفع_حظر') {
        const allowed = isGroup ? await isAdminOrOwner(sock, from, sender) : isBotOwner(sender);
        if (!allowed) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }

        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        if (!mentioned || mentioned.length === 0) {
          await sock.sendMessage(from, { text: '⚠️ لازم تعمل منشن للشخص، مثال: .حظر @شخص' });
          return;
        }

        const target = mentioned[0];

        if (command === '.حظر') {
          if (!banned.includes(target)) {
            banned.push(target);
            saveJSON(BANNED_FILE, banned);
          }
          await sock.sendMessage(from, { text: '🚫 ✦ *تم حظر الشخص من استخدام البوت.* ✦' });
        } else {
          banned = banned.filter((id) => id !== target);
          saveJSON(BANNED_FILE, banned);
          await sock.sendMessage(from, { text: '✅ ✦ *تم رفع الحظر عن الشخص.* ✦' });
        }
      }

      // ==== أوامر إدارة إضافية (أدمن القروب أو مالك البوت) ====
      else if (command === '.اسم_القروب') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        const newName = args.join(' ');
        if (!newName) {
          await sock.sendMessage(from, { text: '⚠️ اكتب الاسم الجديد، مثال: .اسم_القروب أصدقاء الخير' });
          return;
        }
        try {
          await sock.groupUpdateSubject(from, newName);
          await sock.sendMessage(from, { text: `✅ ✦ *تم تغيير اسم القروب* ✦\n📛 ${newName}` });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ ما قدرت أغيّر الاسم، تأكد إن البوت أدمن بالقروب.' });
        }
      }

      else if (command === '.وصف_القروب') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        const newDesc = args.join(' ');
        if (!newDesc) {
          await sock.sendMessage(from, { text: '⚠️ اكتب الوصف الجديد بعد الأمر.' });
          return;
        }
        try {
          await sock.groupUpdateDescription(from, newDesc);
          await sock.sendMessage(from, { text: '✅ ✦ *تم تحديث وصف القروب.* ✦' });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ ما قدرت أغيّر الوصف، تأكد إن البوت أدمن بالقروب.' });
        }
      }

      else if (command === '.رابط') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        try {
          const code = await sock.groupInviteCode(from);
          await sock.sendMessage(from, { text: `🔗 ✦ *رابط دعوة القروب* ✦\nhttps://chat.whatsapp.com/${code}` });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ ما قدرت أجيب الرابط، تأكد إن البوت أدمن بالقروب.' });
        }
      }

      else if (command === '.تحديث_رابط') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        try {
          const code = await sock.groupRevokeInvite(from);
          await sock.sendMessage(from, { text: `🔄 ✦ *تم تحديث رابط الدعوة* ✦\nhttps://chat.whatsapp.com/${code}` });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ ما قدرت أحدّث الرابط، تأكد إن البوت أدمن بالقروب.' });
        }
      }

      else if (command === '.قائمة_المحظورين') {
        const allowed = isGroup ? await isAdminOrOwner(sock, from, sender) : isBotOwner(sender);
        if (!allowed) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        if (banned.length === 0) {
          await sock.sendMessage(from, { text: '📋 ما في حدا محظور حالياً.' });
        } else {
          const list = banned.map((id, i) => `${i + 1}. ${id.split('@')[0]}`).join('\n');
          await sock.sendMessage(from, { text: `📋 ✦ *قائمة المحظورين* ✦\n\n${list}` });
        }
      }

      // ==== 📊 إحصائيات استخدام الأوامر — حصراً لصاحب البوت، يوريه أكثر 15 أمر استخدام ====
      else if (command === '.احصائيات_الاستخدام') {
        if (!isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر حصراً لصاحب البوت.*' });
          return;
        }
        const entries = Object.entries(commandUsage).sort((a, b) => b[1] - a[1]).slice(0, 15);
        if (entries.length === 0) {
          await sock.sendMessage(from, { text: '📊 ما في إحصائيات كافية لسا.' });
        } else {
          const list = entries.map(([cmd, count], i) => `${i + 1}. ${cmd} — ${count} مرة`).join('\n');
          const totalCommands = Object.values(commandUsage).reduce((a, b) => a + b, 0);
          await sock.sendMessage(from, {
            text: `📊 ✦ *الأوامر الأكثر استخداماً* ✦\n\n${list}\n\n📈 إجمالي الأوامر المستخدمة: ${totalCommands}`,
          });
        }
      }

      // ==== 👁️ تفعيل/تعطيل مراقبة رسائل المشاهدة الواحدة (View Once) — حصراً لصاحب البوت ====
      else if (command === '.تفعيل_مراقبة_المشاهدة' || command === '.تعطيل_مراقبة_المشاهدة') {
        if (!isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر حصراً لصاحب البوت.*' });
          return;
        }
        botSettings.antiViewOnce = command === '.تفعيل_مراقبة_المشاهدة';
        saveBotSettings();
        await sock.sendMessage(from, {
          text: botSettings.antiViewOnce
            ? '👁️ ✦ *تم تفعيل مراقبة رسائل المشاهدة الواحدة.* ✦\nأي صورة/فيديو مشاهدة واحدة رح توصلك بالخاص.\n\n⚠️ تذكير: استخدمها بمسؤولية واحترام لخصوصية أعضاء قروباتك.'
            : '✅ تم تعطيل مراقبة رسائل المشاهدة الواحدة.',
        });
      }

      // ==== 💾 نسخة احتياطية فورية لكل بيانات البوت — تُبعت لصاحب البوت كملف JSON ====
      else if (command === '.نسخة_احتياطية') {
        if (!isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر حصراً لصاحب البوت.*' });
          return;
        }
        try {
          const filePath = createBackupBundle();
          await sock.sendMessage(from, {
            document: fs.readFileSync(filePath),
            fileName: filePath.split('/').pop(),
            mimetype: 'application/json',
            caption: '💾 ✦ *نسخة احتياطية من بيانات البوت* ✦',
          });
        } catch (e) {
          console.log('❌ خطأ بإنشاء النسخة الاحتياطية:', e.message);
          await sock.sendMessage(from, { text: '❌ صار خطأ أثناء إنشاء النسخة الاحتياطية.' });
        }
      }

      // ==== 💾 تفعيل/تعطيل النسخ الاحتياطي التلقائي اليومي — حصراً لصاحب البوت ====
      else if (command === '.تفعيل_النسخ_التلقائي' || command === '.تعطيل_النسخ_التلقائي') {
        if (!isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر حصراً لصاحب البوت.*' });
          return;
        }
        botSettings.autoBackup = command === '.تفعيل_النسخ_التلقائي';
        saveBotSettings();
        await sock.sendMessage(from, {
          text: botSettings.autoBackup
            ? '✅ ✦ *تم تفعيل النسخ الاحتياطي التلقائي اليومي.* ✦'
            : '✅ تم تعطيل النسخ الاحتياطي التلقائي اليومي.',
        });
      }

      // ==== 🛡 أوامر إدارة الإنذارات اليدوية ====
      else if (command === '.انذار') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        if (!mentioned || mentioned.length === 0) {
          await sock.sendMessage(from, { text: '⚠️ اعمل منشن للشخص، مثال: .انذار @شخص' });
          return;
        }
        const target = mentioned[0];
        if (!warnings[from]) warnings[from] = {};
        warnings[from][target] = (warnings[from][target] || 0) + 1;
        saveJSON(WARN_FILE, warnings);

        const count = warnings[from][target];
        if (count >= 3) {
          try {
            await sock.groupParticipantsUpdate(from, [target], 'remove');
            await sock.sendMessage(from, {
              text: `🚫 ✦ *تم طرد @${target.split('@')[0]}* ✦\nالسبب: تجاوز 3 إنذارات.`,
              mentions: [target],
            });
          } catch (e) {
            await sock.sendMessage(from, { text: '⚠️ ما قدرت أطرد العضو، تأكد إن البوت أدمن.' });
          }
          delete warnings[from][target];
          saveJSON(WARN_FILE, warnings);
        } else {
          await sock.sendMessage(from, {
            text: `⚠️ ✦ *إنذار ${count}/3* ✦\n@${target.split('@')[0]}\n${3 - count} إنذار متبقي قبل الطرد.`,
            mentions: [target],
          });
        }
      } else if (command === '.مسح_الانذارات') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        if (!mentioned || mentioned.length === 0) {
          await sock.sendMessage(from, { text: '⚠️ اعمل منشن للشخص، مثال: .مسح_الانذارات @شخص' });
          return;
        }
        const target = mentioned[0];
        if (warnings[from]) delete warnings[from][target];
        saveJSON(WARN_FILE, warnings);
        await sock.sendMessage(from, { text: `✅ تم مسح إنذارات @${target.split('@')[0]}`, mentions: [target] });
      }

      // ==== 📌 تثبيت رسالة تلقائياً: اعمل رد (Reply) على أي رسالة واكتب .تثبيت وبيثبتها البوت فوراً ====
      else if (command === '.تثبيت' || command === '.تثبيت_الرسالة') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        const pinCtx = msg.message.extendedTextMessage?.contextInfo;
        const pinStanzaId = pinCtx?.stanzaId;
        const pinParticipant = pinCtx?.participant;
        if (!pinStanzaId || !pinParticipant) {
          await sock.sendMessage(from, {
            text: '⚠️ اعمل رد (Reply) على الرسالة اللي بدك تثبتها، وبعدين اكتب .تثبيت',
          });
          return;
        }
        try {
          await sock.sendMessage(from, {
            pin: {
              type: 1, // PIN_FOR_ALL
              time: 2592000, // 30 يوم — أطول مدة تثبيت متاحة بواتساب
              key: { remoteJid: from, id: pinStanzaId, participant: pinParticipant, fromMe: false },
            },
          });
          await sock.sendMessage(from, { text: '📌 ✦ *تم تثبيت الرسالة بنجاح* ✦' });
        } catch (e) {
          console.log('⚠️ خطأ بتثبيت الرسالة:', e.message);
          await sock.sendMessage(from, {
            text: '❌ ما قدرت أثبت الرسالة. تأكد إن البوت أدمن بالقروب وإن واتساب عندك محدّث.',
          });
        }
      }

      // ==== 📌 إلغاء تثبيت رسالة: رد عليها واكتب .الغاء_تثبيت ====
      else if (command === '.الغاء_تثبيت' || command === '.فك_تثبيت') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        const unpinCtx = msg.message.extendedTextMessage?.contextInfo;
        const unpinStanzaId = unpinCtx?.stanzaId;
        const unpinParticipant = unpinCtx?.participant;
        if (!unpinStanzaId || !unpinParticipant) {
          await sock.sendMessage(from, {
            text: '⚠️ اعمل رد (Reply) على الرسالة المثبتة، وبعدين اكتب .الغاء_تثبيت',
          });
          return;
        }
        try {
          await sock.sendMessage(from, {
            pin: {
              type: 2, // UNPIN_FOR_ALL
              key: { remoteJid: from, id: unpinStanzaId, participant: unpinParticipant, fromMe: false },
            },
          });
          await sock.sendMessage(from, { text: '✅ تم إلغاء تثبيت الرسالة.' });
        } catch (e) {
          console.log('⚠️ خطأ بإلغاء التثبيت:', e.message);
          await sock.sendMessage(from, { text: '❌ ما قدرت ألغي التثبيت.' });
        }
      }

      // ==== 🛡 التحكم بتشغيل/إيقاف الحماية ====
      else if (
        command === '.حماية_الروابط' ||
        command === '.حماية_الالفاظ' ||
        command === '.حماية_السبام' ||
        command === '.حماية_الحذف' ||
        command === '.قفل_الوسائط' ||
        command === '.حماية_المنشن' ||
        command === '.منع_المنشن' ||
        command === '.حماية_التداول' ||
        command === '.حماية_التكرار' ||
        command === '.الحماية'
      ) {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        const state = args[0];
        if (state !== 'تشغيل' && state !== 'ايقاف') {
          await sock.sendMessage(from, {
            text: `⚠️ الصيغة: ${command} تشغيل  أو  ${command} ايقاف`,
          });
          return;
        }
        const enable = state === 'تشغيل';
        if (!protectionSettings[from]) {
          protectionSettings[from] = {
            links: true, words: true, flood: false, antidelete: false, medialock: false,
            mentionguard: true, forwardguard: true, repeatguard: true, warnLimit: 3,
          };
        }

        let label;
        if (command === '.حماية_الروابط') {
          protectionSettings[from].links = enable;
          label = 'حماية الروابط';
        } else if (command === '.حماية_الالفاظ') {
          protectionSettings[from].words = enable;
          label = 'حماية الألفاظ';
        } else if (command === '.حماية_السبام') {
          protectionSettings[from].flood = enable;
          label = 'حماية السبام (رسائل متكررة بسرعة)';
        } else if (command === '.حماية_الحذف') {
          protectionSettings[from].antidelete = enable;
          label = 'تنبيه الرسائل المحذوفة';
        } else if (command === '.قفل_الوسائط') {
          protectionSettings[from].medialock = enable;
          label = 'قفل الوسائط (صور/فيديو/ستيكرات/ملفات)';
        } else if (command === '.حماية_المنشن') {
          protectionSettings[from].mentionguard = enable;
          label = 'حماية المنشن الجماعي المشبوه (أكتر من 5 أشخاص)';
        } else if (command === '.منع_المنشن') {
          protectionSettings[from].nomention = enable;
          label = 'منع المنشن نهائياً (أي منشن، حتى لشخص وحيد، بينحذف)';
        } else if (command === '.حماية_التداول') {
          protectionSettings[from].forwardguard = enable;
          label = 'حماية الرسائل المتداولة كتير (تشين/سبام جاهز)';
        } else if (command === '.حماية_التكرار') {
          protectionSettings[from].repeatguard = enable;
          label = 'حماية تكرار نفس الرسالة';
        } else {
          protectionSettings[from].links = enable;
          protectionSettings[from].words = enable;
          protectionSettings[from].flood = enable;
          protectionSettings[from].antidelete = enable;
          protectionSettings[from].medialock = enable;
          protectionSettings[from].mentionguard = enable;
          protectionSettings[from].forwardguard = enable;
          protectionSettings[from].repeatguard = enable;
          label = 'الحماية الشاملة (كل الأنواع: روابط، ألفاظ، سبام، حذف، وسائط، منشن، تداول، تكرار)';
        }
        saveJSON(PROTECTION_FILE, protectionSettings);

        await sock.sendMessage(from, {
          text: `🛡 ✦ *${label}* ✦\n\nالحالة: ${enable ? '✅ مفعّلة' : '❌ متوقفة'}`,
        });
      }

      // ==== 🛡 تحديد عدد الإنذارات المسموحة قبل الطرد التلقائي (افتراضياً 3) ====
      else if (command === '.حد_الانذارات') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        const num = parseInt(args[0], 10);
        if (!num || num < 1 || num > 10) {
          const current = (protectionSettings[from] && protectionSettings[from].warnLimit) || 3;
          await sock.sendMessage(from, {
            text: `⚠️ الصيغة: .حد_الانذارات <رقم من 1 لـ10>\nالحد الحالي: ${current} إنذارات`,
          });
          return;
        }
        if (!protectionSettings[from]) {
          protectionSettings[from] = { links: true, words: true, flood: false, antidelete: false, medialock: false };
        }
        protectionSettings[from].warnLimit = num;
        saveJSON(PROTECTION_FILE, protectionSettings);
        await sock.sendMessage(from, { text: `🛡 ✦ تم ضبط حد الإنذارات على *${num}* — أي عضو يوصلها بينطرد تلقائياً.` });
      } else if (command === '.حالة_الحماية') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        const settings = protectionSettings[from] || {
          links: true,
          words: true,
          flood: false,
          antidelete: false,
          medialock: false,
          mentionguard: true,
          forwardguard: true,
          repeatguard: true,
          warnLimit: 3,
        };
        await sock.sendMessage(from, {
          text:
            `🛡 ✦ *حالة الحماية الحالية* ✦\n\n` +
            `الروابط: ${settings.links !== false ? '✅ مفعّلة' : '❌ متوقفة'}\n` +
            `الألفاظ: ${settings.words !== false ? '✅ مفعّلة' : '❌ متوقفة'}\n` +
            `السبام: ${settings.flood === true ? '✅ مفعّلة' : '❌ متوقفة'}\n` +
            `تنبيه الحذف: ${settings.antidelete === true ? '✅ مفعّلة' : '❌ متوقفة'}\n` +
            `قفل الوسائط: ${settings.medialock === true ? '✅ مفعّلة' : '❌ متوقفة'}\n` +
            `المنشن الجماعي: ${settings.mentionguard !== false ? '✅ مفعّلة' : '❌ متوقفة'}\n` +
            `منع أي منشن نهائياً: ${settings.nomention === true ? '✅ مفعّلة' : '❌ متوقفة'}\n` +
            `الرسائل المتداولة: ${settings.forwardguard !== false ? '✅ مفعّلة' : '❌ متوقفة'}\n` +
            `تكرار الرسائل: ${settings.repeatguard !== false ? '✅ مفعّلة' : '❌ متوقفة'}\n\n` +
            `⚠️ حد الإنذارات قبل الطرد: ${settings.warnLimit || 3}`,
        });
      }

      else if (command === '.منشن_الكل') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        try {
          const groupMeta = await sock.groupMetadata(from);
          const allParticipants = groupMeta.participants.map((p) => p.id);
          const messageText = args.join(' ') || '📢 تنبيه للجميع';
          await sock.sendMessage(from, { text: `✦ ${messageText} ✦`, mentions: allParticipants });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ صار خطأ أثناء المنشن.' });
        }
      }

      // ==== معلومات القروب (بطاقة أنيقة) ====
      else if (command === '.معلومات_القروب') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        try {
          const groupMeta = await sock.groupMetadata(from);
          const totalMembers = groupMeta.participants.length;
          const totalAdmins = groupMeta.participants.filter(
            (p) => p.admin === 'admin' || p.admin === 'superadmin'
          ).length;
          const createdDate = new Date(groupMeta.creation * 1000).toLocaleDateString('ar-EG');

          await sock.sendMessage(from, {
            text:
              `╭──✦ *بطاقة القروب* ✦──╮\n\n` +
              `📛 *الاسم:* ${groupMeta.subject}\n` +
              `📝 *الوصف:* ${groupMeta.desc || 'لا يوجد'}\n` +
              `👥 *عدد الأعضاء:* ${totalMembers}\n` +
              `👮 *عدد الأدمن:* ${totalAdmins}\n` +
              `📅 *تاريخ الإنشاء:* ${createdDate}\n\n` +
              `╰────────────╯`,
          });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ ما قدرت أجيب معلومات القروب.' });
        }
      }

      // ==== 📊 إحصائيات كاملة عن القروب والبوت ====
      else if (command === '.احصائيات') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        try {
          const groupMeta = await sock.groupMetadata(from);
          const totalMembers = groupMeta.participants.length;
          const msgCount = (groupStats[from] && groupStats[from].messages) || 0;

          const uptimeMs = Date.now() - botStartTime;
          const uptimeH = Math.floor(uptimeMs / 3600000);
          const uptimeM = Math.floor((uptimeMs % 3600000) / 60000);

          // أفضل 3 لاعبين بالقروب حسب نقاطهم (من بين الأعضاء الحاليين)
          const memberNumbers = groupMeta.participants.map((p) => p.id.split('@')[0]);
          const topInGroup = memberNumbers
            .map((num) => [num, points[num] || 0])
            .filter(([, p]) => p > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);

          const topLines =
            topInGroup.length > 0
              ? topInGroup.map(([num, p], i) => `${['🥇', '🥈', '🥉'][i]} @${num} — ${p} نقطة`).join('\n')
              : 'محدا سجّل نقاط بالقروب لسا';

          await sock.sendMessage(from, {
            text:
              `📊 ✦ *إحصائيات القروب* ✦\n\n` +
              `👥 عدد الأعضاء: *${totalMembers}*\n` +
              `💬 عدد الرسائل المسجّلة: *${msgCount}*\n` +
              `⏱️ البوت شغال من: *${uptimeH} ساعة و ${uptimeM} دقيقة*\n\n` +
              `🏆 *أفضل 3 لاعبين بالقروب:*\n${topLines}`,
            mentions: topInGroup.map(([num]) => `${num}@s.whatsapp.net`),
          });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ ما قدرت أجيب الإحصائيات.' });
        }
      }

      // ==== قائمة الأدمن (بطاقة أنيقة) ====
      else if (command === '.قائمة_الادمن') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        try {
          const groupMeta = await sock.groupMetadata(from);
          const admins = groupMeta.participants.filter(
            (p) => p.admin === 'admin' || p.admin === 'superadmin'
          );
          if (admins.length === 0) {
            await sock.sendMessage(from, { text: '📋 ما في أدمن بهاد القروب.' });
            return;
          }
          const list = admins.map((a, i) => `${i + 1}. @${a.id.split('@')[0]}`).join('\n');
          await sock.sendMessage(from, {
            text: `👮 ✦ *أدمن القروب* ✦\n\n${list}`,
            mentions: admins.map((a) => a.id),
          });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ ما قدرت أجيب قائمة الأدمن.' });
        }
      }

      // ==== أوامر الأدمن (داخل القروبات فقط، أدمن القروب أو مالك البوت) ====
      else if (['.كيك', '.طرد', '.ترقية', '.تنزيل'].includes(command)) {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }

        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }

        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        if (!mentioned || mentioned.length === 0) {
          await sock.sendMessage(from, { text: `⚠️ لازم تعمل منشن للشخص، مثال: ${command} @شخص` });
          return;
        }

        const target = mentioned[0];

        // 🛡️ حماية: ما تخلي حدا يطرد أو ينزل مالك البوت
        if (command !== '.ترقية' && isBotOwner(target)) {
          await sock.sendMessage(from, { text: '⛔ ما فيك تعمل هيك الأمر على مالك البوت.' });
          return;
        }

        // 🛡️ فحص: البوت لازم يكون أدمن بالقروب أصلاً حتى ينفذ أي أمر من هدول
        // (بيستخدم فحص مقاوم لمشكلة @lid — إذا ما قدرنا نتأكد بشكل مضمون، منسيب واتساب نفسها ترفض العملية بدل ما نمنعها غلط)
        const botIsAdmin = await isBotAdminInGroup(sock, from);
        if (botIsAdmin === false) {
          await sock.sendMessage(from, {
            text: '⛔ *البوت لازم يكون أدمن بالقروب حتى ينفذ هاد الأمر!*\nروح لإعدادات القروب وخليه أدمن وجرب تاني.',
          });
          return;
        }

        try {
          if (command === '.كيك' || command === '.طرد') {
            await sock.groupParticipantsUpdate(from, [target], 'remove');
            await sock.sendMessage(from, { text: '✅ ✦ *تم طرد العضو.* ✦' });
          } else if (command === '.ترقية') {
            await sock.groupParticipantsUpdate(from, [target], 'promote');
            await sock.sendMessage(from, { text: '👑 ✦ *تم ترقية العضو لأدمن.* ✦' });
          } else if (command === '.تنزيل') {
            await sock.groupParticipantsUpdate(from, [target], 'demote');
            await sock.sendMessage(from, { text: '⬇️ ✦ *تم إنزال العضو من الإدارة.* ✦' });
          }
        } catch (e) {
          console.log(`⚠️ خطأ بأمر ${command}:`, e.message);
          const actionWord = command === '.كيك' || command === '.طرد' ? 'طرد' : command === '.ترقية' ? 'ترقية' : 'إنزال';
          await sock.sendMessage(from, {
            text:
              `❌ ما قدرت أعمل ${actionWord} للعضو.\n\n` +
              `الأسباب المحتملة:\n` +
              `• الشخص أدمن أو مالك القروب (ما بينطرد بسهولة)\n` +
              `• الشخص طلع من القروب أصلاً\n` +
              `• صلاحيات البوت تغيرت لحظياً`,
          });
        }
      }

      // ==== 👥 طرد أكتر من عضو دفعة وحدة (منشن كذا شخص مع بعض) ====
      else if (command === '.كيك_الكل') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        if (!mentioned || mentioned.length === 0) {
          await sock.sendMessage(from, { text: '⚠️ اعمل منشن لكل الأشخاص يلي بدك تطردهم مع بعض، مثال: .كيك_الكل @شخص1 @شخص2' });
          return;
        }
        const targets = mentioned.filter((jid) => !isBotOwner(jid));
        if (targets.length === 0) {
          await sock.sendMessage(from, { text: '⛔ ما فيك تطرد مالك البوت.' });
          return;
        }
        try {
          await sock.groupParticipantsUpdate(from, targets, 'remove');
          await sock.sendMessage(from, { text: `✅ ✦ *تم طرد ${targets.length} عضو دفعة وحدة.* ✦` });
        } catch (e) {
          console.log('⚠️ خطأ بأمر .كيك_الكل:', e.message);
          await sock.sendMessage(from, {
            text: '❌ ما قدرت أطرد كلهم. تأكد إنه البوت أدمن، وإنه محدش من اللي منشنتهم أدمن أو مالك القروب.',
          });
        }
      }

      // ==== 🧹 إلغاء حظر كل الأعضاء المحظورين من استخدام البوت بضربة وحدة (مالك البوت بس، لأنها قائمة عامة مو خاصة بقروب وحيد) ====
      else if (command === '.الغاء_حظر_الكل') {
        if (!isBotOwner(sender)) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر لمالك البوت فقط* (لأنه بيمسح قائمة الحظر العامة لكل القروبات).' });
          return;
        }
        const before = banned.length;
        banned = [];
        saveJSON(BANNED_FILE, banned);
        await sock.sendMessage(from, { text: `✅ ✦ *تم مسح قائمة الحظر بالكامل.* ✦ (كان فيها ${before} شخص)` });
      }

      // ==== 🛡️ تفعيل حماية شاملة بضغطة وحدة (كل أنواع الحماية بأقصى درجة مع بعض) ====
      else if (command === '.الحماية_الشاملة') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        protectionSettings[from] = {
          links: true, words: true, flood: true, antidelete: true, medialock: false,
          mentionguard: true, forwardguard: true, repeatguard: true, warnLimit: 3,
        };
        saveJSON(PROTECTION_FILE, protectionSettings);
        await sock.sendMessage(from, {
          text:
            `🛡️✨ ✦ *تم تفعيل الحماية الشاملة!* ✦ ✨🛡️\n\n` +
            `✅ حماية الروابط\n✅ حماية الألفاظ\n✅ حماية السبام\n✅ تنبيه الحذف\n` +
            `✅ حماية المنشن الجماعي\n✅ حماية الرسائل المتداولة\n✅ حماية تكرار الرسائل\n` +
            `⚠️ حد الإنذارات: 3 (عدّله بـ .حد_الانذارات)\n\n` +
            `القروب صار محمي بأقصى درجة! 🔒\n\n` +
            `💡 قفل الوسائط تركناه مطفي افتراضياً (بيمنع أي صور/فيديو/ستيكر)، فعّله يدوياً بـ .قفل_الوسائط تشغيل لو بدك.`,
        });
      }

      // ==== 🔇 كتم عضو مؤقتاً (رسائله تنحذف تلقائياً لمدة محددة) ====
      else if (command === '.كتم') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        if (!mentioned || mentioned.length === 0) {
          await sock.sendMessage(from, { text: '⚠️ لازم تعمل منشن للشخص، مثال: .كتم @شخص 10 (10 دقايق)' });
          return;
        }
        const target = mentioned[0];
        if (isBotOwner(target)) {
          await sock.sendMessage(from, { text: '⛔ ما فيك تكتم مالك البوت.' });
          return;
        }
        const minutes = parseInt(args.find((a) => /^\d+$/.test(a)) || '10', 10);
        if (!mutedUsers[from]) mutedUsers[from] = {};
        mutedUsers[from][pointsKey(target)] = Date.now() + minutes * 60 * 1000;
        saveMutes();

        const targetDigits = target.split('@')[0];
        const releaseTime = new Date(Date.now() + minutes * 60 * 1000).toLocaleTimeString('ar-EG', {
          hour: '2-digit',
          minute: '2-digit',
        });
        const caption =
          `🚔 ✦ *تم سجن* @${targetDigits} *لمدة ${minutes} دقيقة* ✦\n` +
          `رسائله رح تنحذف تلقائياً لحد الإفراج الساعة ${releaseTime}.`;

        try {
          const jailImage = await buildJailCard(await fetchProfilePicBuffer(sock, target), targetDigits);
          await sock.sendMessage(from, { image: jailImage, caption, mentions: [target] });
        } catch (e) {
          console.log('⚠️ ما قدرت أبني صورة السجن (.كتم):', e.message);
          await sock.sendMessage(from, { text: caption, mentions: [target] });
        }
      }

      // ==== 🔊 إلغاء الكتم قبل ما تنتهي المدة ====
      else if (command === '.الغاء_كتم') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        if (!mentioned || mentioned.length === 0) {
          await sock.sendMessage(from, { text: '⚠️ لازم تعمل منشن للشخص، مثال: .الغاء_كتم @شخص' });
          return;
        }
        const target = mentioned[0];
        if (mutedUsers[from]) {
          delete mutedUsers[from][pointsKey(target)];
          saveMutes();
        }
        await sock.sendMessage(from, { text: `🔊 ✦ *تم رفع الكتم عن* @${target.split('@')[0]}`, mentions: [target] });
      }

      // ==== 🐢 تفعيل/تعديل الوضع البطيء (مهلة إجبارية بين رسائل غير الأدمن) ====
      else if (command === '.الوضع_البطيء') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        const seconds = parseInt(args[0], 10);
        if (!seconds || seconds < 1 || seconds > 600) {
          await sock.sendMessage(from, { text: '⚠️ حدد عدد الثواني (1-600)، مثال: .الوضع_البطيء 15' });
          return;
        }
        slowMode[from] = seconds;
        saveSlowMode();
        await sock.sendMessage(from, {
          text: `🐢 ✦ *تم تفعيل الوضع البطيء: رسالة كل ${seconds} ثانية لغير الأدمن* ✦`,
        });
      }

      // ==== 🐇 إلغاء الوضع البطيء ====
      else if (command === '.الغاء_البطيء') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ هاد الأمر يشتغل بالقروبات فقط.' });
          return;
        }
        if (!(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ *هاد الأمر للأدمن فقط.*' });
          return;
        }
        delete slowMode[from];
        saveSlowMode();
        await sock.sendMessage(from, { text: '🐇 ✦ *تم إلغاء الوضع البطيء.* ✦' });
      }

      // ==== 💼 عرض/اختيار وظيفة ====
      else if (command === '.وظيفة') {
        const entry = getJobEntry(sender);
        if (!args[0]) {
          const list = JOB_LIST.map((j) => `${j.name} — .وظيفة ${j.id}`).join('\n');
          const current = entry.job ? `\n\n💼 وظيفتك الحالية: *${JOB_LIST.find((j) => j.id === entry.job)?.name || entry.job}*` : '\n\n💼 ما عندك وظيفة لسا.';
          await sock.sendMessage(from, { text: `📋 ✦ *الوظائف المتاحة* ✦\n\n${list}${current}\n\nاشتغل بأمر: .اشتغل` });
          return;
        }
        const chosen = JOB_LIST.find((j) => j.id === args[0].trim());
        if (!chosen) {
          await sock.sendMessage(from, { text: '⚠️ وظيفة غير موجودة. اكتب .وظيفة بدون شي عشان تشوف القائمة.' });
          return;
        }
        entry.job = chosen.id;
        saveJobs();
        await sock.sendMessage(from, { text: `✅ ✦ *صرت ${chosen.name}!* ✦\n\nاشتغل بأمر .اشتغل (مرة كل ساعة)` });
      }

      // ==== 💰 الاشتغال بالوظيفة الحالية لكسب نقاط (بحد أقصى مرة كل ساعة) ====
      else if (command === '.اشتغل') {
        const entry = getJobEntry(sender);
        if (!entry.job) {
          await sock.sendMessage(from, { text: '⚠️ لازم تختار وظيفة الأول: .وظيفة' });
          return;
        }
        const now = Date.now();
        const remaining = JOB_COOLDOWN_MS - (now - (entry.lastWork || 0));
        if (remaining > 0) {
          const mins = Math.ceil(remaining / 60000);
          await sock.sendMessage(from, { text: `⏳ لازم تستنى *${mins}* دقيقة كمان قبل ما تشتغل مرة ثانية.` });
          return;
        }
        const jobInfo = JOB_LIST.find((j) => j.id === entry.job);
        const earned = Math.floor(Math.random() * (jobInfo.max - jobInfo.min + 1)) + jobInfo.min;
        entry.lastWork = now;
        saveJobs();
        const newTotal = addPoints(sender, earned);
        const stats = getStatsEntry(sender);
        const before = stats.jobsWorked;
        stats.jobsWorked = before + 1;
        saveStats();
        await checkStatAchievement(sock, from, sender, 'jobsWorked', before, stats.jobsWorked);
        await sock.sendMessage(from, {
          text: `${jobInfo.name} ✦ *اشتغلت وكسبت ${earned} نقطة* ✦\n💰 مجموعك الآن: *${newTotal}*`,
        });
      }

      // ==== 📈 استثمار نقاط بمخاطرة (فرصة تضاعف أو تخسر جزء منها) ====
      else if (command === '.استثمار') {
        const amount = parseInt(args[0], 10);
        if (!amount || amount <= 0) {
          await sock.sendMessage(from, { text: '⚠️ حدد كم نقطة بدك تستثمر، مثال: .استثمار 50' });
          return;
        }
        const current = getPoints(sender);
        if (current < amount) {
          await sock.sendMessage(from, { text: `⚠️ ما عندك نقاط كفاية. رصيدك الحالي: ${current}` });
          return;
        }
        const entry = getJobEntry(sender);
        const now = Date.now();
        const remaining = INVEST_COOLDOWN_MS - (now - (entry.lastInvest || 0));
        if (remaining > 0) {
          const mins = Math.ceil(remaining / 60000);
          await sock.sendMessage(from, { text: `⏳ لازم تستنى *${mins}* دقيقة كمان قبل استثمار جديد.` });
          return;
        }
        entry.lastInvest = now;
        saveJobs();

        const won = Math.random() < 0.45; // 45% فرصة ربح — الاستثمار فيه مخاطرة حقيقية
        if (won) {
          const profit = Math.round(amount * (0.5 + Math.random())); // ربح بين 50% و150% من المبلغ
          const newTotal = addPoints(sender, profit);
          const stats = getStatsEntry(sender);
          const before = stats.investWins;
          stats.investWins = before + 1;
          saveStats();
          await checkStatAchievement(sock, from, sender, 'investWins', before, stats.investWins);
          await sock.sendMessage(from, {
            text: `📈 ✦ *استثمار ناجح!* ✦\n🎉 ربحت +${profit} نقطة\n💰 رصيدك الآن: *${newTotal}*`,
          });
        } else {
          const loss = Math.round(amount * (0.3 + Math.random() * 0.4)); // خسارة 30-70% من المبلغ
          const newTotal = addPoints(sender, -loss);
          await sock.sendMessage(from, {
            text: `📉 ✦ *خسر الاستثمار!* ✦\n💔 خسرت -${loss} نقطة\n💰 رصيدك الآن: *${newTotal}*`,
          });
        }
      }

      // ==== ✍️ تحديد سيرة ذاتية قصيرة تظهر بالبروفايل ====
      else if (command === '.سيرتي') {
        const bioText = args.join(' ').trim();
        const stats = getStatsEntry(sender);
        if (!bioText) {
          await sock.sendMessage(from, {
            text: stats.bio ? `📝 سيرتك الحالية:\n${stats.bio}` : '⚠️ ما حددت سيرة لسا. مثال: .سيرتي أحب القراءة والبرمجة',
          });
          return;
        }
        if (bioText.length > 150) {
          await sock.sendMessage(from, { text: '⚠️ السيرة طويلة كتير، خليها أقل من 150 حرف.' });
          return;
        }
        stats.bio = bioText;
        saveStats();
        await sock.sendMessage(from, { text: '✅ ✦ *تم تحديث سيرتك الذاتية!* ✦ اكتب .بروفايلي لتشوفها.' });
      }

      // ==== 🏆 عرض قائمة الإنجازات الإحصائية (مفتوحة/مقفولة) ====
      else if (command === '.انجازاتي') {
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        const target = mentioned && mentioned.length > 0 ? mentioned[0] : sender;
        const stats = getStatsEntry(target);
        const lines = statAchievements.map((a) => {
          const value = stats[a.key] || 0;
          const unlocked = value >= a.min;
          return `${unlocked ? '✅' : '🔒'} ${a.emoji} *${a.name}* — ${a.desc}${unlocked ? '' : ` (${value}/${a.min})`}`;
        });
        await sock.sendMessage(from, {
          text: `🏆 ✦ *إنجازات* @${target.split('@')[0]} ✦\n\n${lines.join('\n')}`,
          mentions: [target],
        });
      }

      // ==== 🕵️ شرح مفصل لقواعد لعبة المافيا ====
      else if (command === '.مساعدة_مافيا') {
        await sock.sendMessage(from, {
          text:
            `╭─❍───────────────❍─╮\n` +
            `   🦠⚔️ *مافيا: نسخة أمونس الأسطورية* ⚔️🦠\n` +
            `╰─❍───────────────❍─╯\n\n` +
            `_قدّم لكم فيروس أمونس الخطير أقوى نسخة من لعبة المافيا... أدوار سرية، خيانة، وأغراض أسطورية تقلب اللعبة رأساً على عقب 😈_\n\n` +
            `📖 *الفكرة:*\n` +
            `مجموعة لاعبين، بعضهم "مافيا" (أشرار) مختبيين بين "مواطنين" (أخيار)، وممكن يكون فيها لاعبين بأدوار خاصة ومستقلة. كل ليلة المافيا تقتل حدا بالسر، وكل نهار الكل يناقش ويصوّت يطرد المشتبه فيه. اللعبة تستمر لحد ما فريق يحسم الفوز.\n\n` +
            `1️⃣ *بدء اللعبة:*\n` +
            `.مافيا_ابدأ (أو اختصار سريع: .مافيا_يلا) — يفتح لوبي انضمام لمدة 45 ثانية (جماعية)\n` +
            `.مافيا_انضم — تنضم للعبة (لازم 4 لاعبين ع الأقل، أقصى حد 10)\n` +
            `.مافيا_الغاء — المضيف أو أدمن القروب يلغي اللعبة\n` +
            `🧍 .مافيا_فردي [عدد] — تلعب لحالك فوراً ضد لاعبين آليين (بلا لوبي انضمام)، مفيدة لما ما يكون في عدد كافي من الناس. افتراضياً 6 لاعبين، تقدر تحدد أي عدد من 4 لـ10\n` +
            `⚡ .مافيا_بدء_الآن — لو صارت .مافيا_فردي بقروب، المضيف يقدر يكتبها يبلش فوراً بدل ما ينتظر الـ45 ثانية\n\n` +
            `2️⃣ *الأدوار (تنبعت إلك بالخاص بعد ما تخلص فترة الانضمام):*\n` +
            `🔪 *مافيا* — تقريباً ربع اللاعبين (على الأقل واحد)، بيعرفوا بعض، وكل ليلة يتفقوا يقتلوا حدا\n` +
            `💊 *طبيب* — واحد بس، كل ليلة يحمي شخص من القتل\n` +
            `🔍 *محقق* — واحد بس، كل ليلة يتحقق من شخص هل هو مافيا أو لأ\n` +
            `🎯 *قناص* (من 6 لاعبين+) — عنده رصاصة وحدة بكل اللعبة، يصوبها أي ليلة يختارها. لو صاب مافيا فعلي بيموت فوراً، ولو غلط وصاب بريء بيموت القناص نفسه بدالو!\n` +
            `🃏 *مهرج* (من 7 لاعبين+) — مش مع حدا! هدفه الوحيد إنه يخلي الناس يصوّتوا عليه بالنهار ويطردوه. لو نجح بيفوز وحده حتى لو خسر الجميع\n` +
            `👑 *عمدة* (من 8 لاعبين+) — مواطن عادي بس صوته بالتصويت النهاري يساوي *صوتين* بالسر، محدا بيعرف هويته\n` +
            `🕴️ *تاجر بشر* (من 9 لاعبين+) — مش مع حدا! كل ليلة بيهرّب شخص من اللعبة بأمر .تهريب. لو نجح يهرّب 3 أشخاص ولسا حي، بيفوز وحده!\n` +
            `🙂 *مواطن عادي* — الباقي، ما عنده قدرة ليلية، بس عقله ولسانه بالنهار\n\n` +
            `3️⃣ *مرحلة الليل (60 ثانية بالجماعية، 25 بالفردية، أوامر بالخاص للبوت):*\n` +
            `🔒 *مهم:* كل أوامر الليل لازم تترسل بالخاص مع البوت فقط — لو حاولت تبعتها بالقروب، البوت رح يرفضها ويطلب منك ترسلها بالخاص، حتى دورك وهدفك يضلوا سر ومحدا بيقدر يشوفهم غيرك.\n` +
            `.قتل <رقم> — المافيا يختار ضحية (ما يقدروا يقتلوا بعض)\n` +
            `.حماية <رقم> — الطبيب يحمي حدا من القتل هالليلة\n` +
            `.تحقيق <رقم> — المحقق يعرف فوراً هل هالشخص مافيا أو لأ\n` +
            `.قنص <رقم> — القناص يستخدم رصاصته (مرة وحدة بكل اللعبة، أي ليلة يختارها)\n` +
            `.تهريب <رقم> — تاجر البشر يهرّب هدفه لهالليلة (فيه يعيدها كل ليلة)\n` +
            `(الأرقام بتظهرلكم بقائمة اللاعبين الأحياء يلي البوت بيبعتها)\n\n` +
            `4️⃣ *نتيجة الليل + مرحلة النهار (90 ثانية، بالقروب):*\n` +
            `البوت يعلن مين مات الليلة (المافيا/الطبيب) ونتيجة رصاصة القناص لو استخدمها\n` +
            `بعدين الأحياء يناقشوا مين برأيهم مافيا، وكل واحد يصوّت بـ:\n` +
            `.تصويت <رقم> (أو منشن مباشر للاعب) — اللي بياخد أكتر أصوات بينطرد من اللعبة\n` +
            `.الغاء_تصويت — تسحب صوتك أو تغيّره لغيره وقت ما بدك\n` +
            `📊 بعد كل صوت البوت يعرضلكم عدد اللي صوّتوا لهلق، ولو صوّت كل الأحياء، النتيجة بتطلع فوراً بلا انتظار\n` +
            `⚖️ لو صار تعادل بالأصوات، محدا بيطلع هالنهار، والبوت بيعرضلكم تفاصيل كل الأصوات ومين ما صوّت\n` +
            `🃏 لو اللي طلع بالتصويت كان المهرج، اللعبة بتنتهي فوراً وهو بيفوز وحده!\n\n` +
            `5️⃣ *الدورة بتتكرر:* ليل ← موت/نجاة ← نهار ← طرد بالتصويت ← ليل تاني... لحد ما يتحقق شرط الفوز.\n\n` +
            `🏆 *شرط الفوز:*\n` +
            `✅ المواطنين يفوزوا لو قضوا على كل أعضاء المافيا\n` +
            `✅ المافيا تفوز لو صار عددهم مساوي أو أكبر من عدد الباقيين الأحياء\n` +
            `✅ المهرج يفوز وحده لو نجح يخلي الناس يطردوه بالتصويت (فوزه بونص أكبر: +30 نقطة!)\n` +
            `✅ تاجر البشر يفوز وحده لو هرّب 3 أشخاص ولسا حي (فوزه بونص أكبر: +35 نقطة!)\n\n` +
            `🦠⚔️ *متجر أمونس الأسطوري (.متجر_المافيا):*\n` +
            `أغراض قوى تشتريها بنقاطك العادية وتستخدمها تلقائياً بأي لعبة مافيا تلعبها بعدين:\n` +
            `🛡️ *درع_امونس* (80 نقطة) — يحميك تلقائياً أول مرة تنقتل/تنهرّب فيها بالليل\n` +
            `👑 *نفوذ_امونس* (70 نقطة) — صوتك بالتصويت يساوي صوتين لمرة وحدة\n` +
            `🎭 *قناع_امونس* (90 نقطة) — لو حقق فيك المحقق وأنت مافيا، النتيجة بتطلع بريء\n` +
            `💀 *بعث_امونس* (250 نقطة، ⚜️ أسطوري نادر) — لو انقتلت أو انطردت، بترجع للحياة فوراً بنفس اللعبة\n` +
            `🛍️ اشتري بـ: *.شراء <الاسم>* — مثال: .شراء درع_امونس\n\n` +
            `💡 *نصايح سريعة:*\n` +
            `مافيا؟ تظاهر إنك مواطن عادي وما تلفت الأنظار\n` +
            `محقق؟ حقق بهدوء، وفكر منيح متى تكشف اللي لقيته\n` +
            `طبيب؟ حاول تحمي الأشخاص المهمين بدون ما حدا يعرف مين انت\n` +
            `قناص؟ ما تستعجل، رصاصتك وحدة بس ولازم تكون شبه متأكد قبل ما تطلقها\n` +
            `مهرج؟ تصرف بشكل مريب قصداً حتى يشكوا فيك ويصوّتوا عليك!\n` +
            `عمدة؟ حافظ على سرك واستخدم صوتك المضاعف بلحظة حاسمة\n` +
            `تاجر بشر؟ هرّب بهدوء وحاول ما تخلي حدا يحس إنك السبب باختفاء الناس\n` +
            `مواطن؟ راقب تصرفات وكلام الناس وحاول تستنتج مين مريب\n\n` +
            `🧍 *وضع اللعب الفردي (.مافيا_فردي):* تلعب لحالك ضد لاعبين آليين بياخدوا قراراتهم (قتل/حماية/تحقيق/تصويت...) أوتوماتيكياً. أنت بتاخد دورك عشوائي متل أي لاعب وبتستخدم نفس أوامر اللعبة الجماعية بالضبط، بس بأوقات أقصر. لو صارت بقروب، أي حدا فيه ينضم معاك بـ .مافيا_انضم خلال 45 ثانية ويلعب دوره بنفسه، والباقي بس بيتعبى بلاعبين آليين.\n\n` +
            `🏅 كل فوز بيسجلّك نقطة إحصائية (mafiaWins) وفي إنجازات خاصة باللعبة.\n` +
            `ℹ️ ملخص سريع للأوامر: .قائمة_الالعاب`,
        });
      }

      // ==== 🕵️ لعبة المافيا: بدء اللعبة وفتح باب الانضمام ====
      else if (command === '.مافيا_ابدأ' || command === '.مافيا_يلا') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: '⚠️ لعبة المافيا تشتغل بالقروبات فقط. جرب *.مافيا_فردي* لو بدك تلعب بالخاص.' });
          return;
        }
        if (mafiaGames[from]) {
          await sock.sendMessage(from, { text: '⚠️ في لعبة مافيا شغالة أصلاً بهاد القروب.' });
          return;
        }
        mafiaGames[from] = { phase: 'lobby', players: [{ jid: sender, alive: true }], hostSender: sender };
        await sock.sendMessage(from, {
          text:
            `🕵️ ✦ *بدأت لعبة مافيا جديدة!* ✦\n\n` +
            `انضم بأمر *.مافيا_انضم* (لازم 4 لاعبين على الأقل، أقصى حد 10)\n` +
            `عندكم 45 ثانية للانضمام ⏰\n\n` +
            `📖 *كيف تلعب بسرعة:*\n` +
            `• كل واحد ياخد دور سري بالخاص (مافيا/طبيب/محقق/مواطن...)\n` +
            `• بالليل: أصحاب الأدوار الخاصة يبعتوا قرارهم بالخاص للبوت\n` +
            `• بالنهار: الكل بالقروب يناقش ويصوّت بـ *.تصويت [رقم]* على مين يطردوا\n` +
            `• كل دور رح توصلك تفاصيله كاملة بالخاص وقت ما تنبدأ اللعبة، محتاج تحفظ شي 📩\n\n` +
            `👤 انضم: @${sender.split('@')[0]}`,
          mentions: [sender],
        });
        setTimeout(() => startMafiaNight(sock, from), 45000);
      }

      // ==== 🕵️ الانضمام للعبة مافيا مفتوحة ====
      else if (command === '.مافيا_انضم') {
        if (!isGroup || !mafiaGames[from] || mafiaGames[from].phase !== 'lobby') {
          await sock.sendMessage(from, { text: '⚠️ ما في لعبة مافيا مفتوحة للانضمام حالياً. ابدأ وحدة بـ .مافيا_ابدأ' });
          return;
        }
        const game = mafiaGames[from];
        if (game.players.some((p) => p.jid === sender)) {
          await sock.sendMessage(from, { text: '⚠️ أنت منضم أصلاً!' });
          return;
        }
        if (game.players.length >= 10) {
          await sock.sendMessage(from, { text: '⚠️ اكتمل العدد الأقصى (10 لاعبين).' });
          return;
        }
        game.players.push({ jid: sender, alive: true });
        await sock.sendMessage(from, {
          text: `👤 ✦ انضم @${sender.split('@')[0]} ✦ (المجموع: ${game.players.length})`,
          mentions: [sender],
        });
      }

      // ==== 🕵️ إلغاء لعبة مافيا الحالية (المضيف أو أدمن القروب) ====
      else if (command === '.مافيا_الغاء') {
        if (!isGroup || !mafiaGames[from]) {
          await sock.sendMessage(from, { text: '⚠️ ما في لعبة مافيا شغالة حالياً.' });
          return;
        }
        const game = mafiaGames[from];
        if (sender !== game.hostSender && !(await isAdminOrOwner(sock, from, sender))) {
          await sock.sendMessage(from, { text: '⛔ بس اللي بدأ اللعبة أو أدمن القروب يقدر يلغيها.' });
          return;
        }
        delete mafiaGames[from];
        await sock.sendMessage(from, { text: '🛑 ✦ *تم إلغاء لعبة المافيا.* ✦' });
      }

      // ==== 🔪 أمر المافيا الليلي (بالخاص): اختيار ضحية ====
      else if (command === '.قتل') {
        if (isGroup) {
          await sock.sendMessage(from, { text: '🔒 هاد الأمر لازم يترسل بالخاص مع البوت (مو بالقروب)، حتى ما ينكشف دورك وهدفك لباقي اللاعبين!' });
          return;
        }
        const found = findActiveMafiaByDM(pointsKey(sender));
        if (!found || found.player.role !== 'مافيا') {
          await sock.sendMessage(from, { text: '⚠️ ما عندك دور مافيا نشط حالياً بأي لعبة.' });
          return;
        }
        const idx = parseInt(args[0], 10) - 1;
        // ==== نستخدم نفس ترقيم القائمة الكاملة يلي وصلت للقروب، حتى ما يصير لغبطة بالأرقام ====
        const alive = mafiaAliveList(found.game);
        if (isNaN(idx) || !alive[idx]) {
          await sock.sendMessage(from, { text: '⚠️ رقم غير صحيح. استخدم الترقيم يلي وصلك بالقروب.' });
          return;
        }
        if (alive[idx].role === 'مافيا') {
          await sock.sendMessage(from, { text: '⚠️ ما فيك تقتل زميلك بالمافيا!' });
          return;
        }
        found.game.nightActions.killTarget = alive[idx].jid;
        await sock.sendMessage(from, { text: `🔪 اخترت تقتل @${alive[idx].jid.split('@')[0]} الليلة.` });
      }

      // ==== 🎯 أمر القناص الليلي (بالخاص): رصاصة وحدة بكل اللعبة ====
      else if (command === '.قنص') {
        if (isGroup) {
          await sock.sendMessage(from, { text: '🔒 هاد الأمر لازم يترسل بالخاص مع البوت (مو بالقروب)، حتى ما ينكشف دورك وهدفك لباقي اللاعبين!' });
          return;
        }
        const found = findActiveMafiaByDM(pointsKey(sender));
        if (!found || found.player.role !== 'قناص') {
          await sock.sendMessage(from, { text: '⚠️ ما عندك دور قناص نشط حالياً بأي لعبة.' });
          return;
        }
        if (found.player.sniperUsed) {
          await sock.sendMessage(from, { text: '⚠️ خلصت رصاصتك الوحيدة! ما فيك تقنص مرة تانية بهاد اللعبة.' });
          return;
        }
        const idx = parseInt(args[0], 10) - 1;
        // ==== نستخدم نفس ترقيم القائمة الكاملة يلي وصلت للقروب، حتى ما يصير لغبطة بالأرقام ====
        const alive = mafiaAliveList(found.game);
        if (isNaN(idx) || !alive[idx]) {
          await sock.sendMessage(from, { text: '⚠️ رقم غير صحيح. استخدم الترقيم يلي وصلك بالقروب.' });
          return;
        }
        if (alive[idx].jid === sender) {
          await sock.sendMessage(from, { text: '⚠️ ما فيك تقنص حالك!' });
          return;
        }
        found.player.sniperUsed = true;
        found.game.nightActions.sniperShooterJid = sender;
        found.game.nightActions.sniperTarget = alive[idx].jid;
        await sock.sendMessage(from, {
          text: `🎯 صوبت على @${alive[idx].jid.split('@')[0]} الليلة... رح تعرف النتيجة آخر الليل. حظ سعيد 🤞`,
        });
      }

      // ==== 💊 أمر الطبيب الليلي (بالخاص): حماية شخص ====
      else if (command === '.حماية') {
        if (isGroup) {
          await sock.sendMessage(from, { text: '🔒 هاد الأمر لازم يترسل بالخاص مع البوت (مو بالقروب)، حتى ما ينكشف دورك وهدفك لباقي اللاعبين!' });
          return;
        }
        const found = findActiveMafiaByDM(pointsKey(sender));
        if (!found || found.player.role !== 'طبيب') {
          await sock.sendMessage(from, { text: '⚠️ ما عندك دور طبيب نشط حالياً بأي لعبة.' });
          return;
        }
        const idx = parseInt(args[0], 10) - 1;
        const alive = mafiaAliveList(found.game);
        if (isNaN(idx) || !alive[idx]) {
          await sock.sendMessage(from, { text: '⚠️ رقم غير صحيح. استخدم الترقيم يلي وصلك بالقروب.' });
          return;
        }
        found.game.nightActions.saveTarget = alive[idx].jid;
        await sock.sendMessage(from, { text: `💊 اخترت تحمي @${alive[idx].jid.split('@')[0]} الليلة.` });
      }

      // ==== 🔍 أمر المحقق الليلي (بالخاص): فحص شخص ====
      else if (command === '.تحقيق') {
        if (isGroup) {
          await sock.sendMessage(from, { text: '🔒 هاد الأمر لازم يترسل بالخاص مع البوت (مو بالقروب)، حتى ما ينكشف دورك وهدفك لباقي اللاعبين!' });
          return;
        }
        const found = findActiveMafiaByDM(pointsKey(sender));
        if (!found || found.player.role !== 'محقق') {
          await sock.sendMessage(from, { text: '⚠️ ما عندك دور محقق نشط حالياً بأي لعبة.' });
          return;
        }
        const idx = parseInt(args[0], 10) - 1;
        const alive = mafiaAliveList(found.game);
        if (isNaN(idx) || !alive[idx]) {
          await sock.sendMessage(from, { text: '⚠️ رقم غير صحيح. استخدم الترقيم يلي وصلك بالقروب.' });
          return;
        }
        found.game.nightActions.checkTarget = alive[idx].jid;
        found.game.nightActions.checkerJid = sender;
        await sock.sendMessage(from, { text: `🔍 رح تعرف نتيجة التحقيق آخر الليلة.` });
      }

      // ==== 🕴️ أمر تاجر البشر الليلي (بالخاص): تهريب شخص ====
      else if (command === '.تهريب') {
        if (isGroup) {
          await sock.sendMessage(from, { text: '🔒 هاد الأمر لازم يترسل بالخاص مع البوت (مو بالقروب)، حتى ما ينكشف دورك وهدفك لباقي اللاعبين!' });
          return;
        }
        const found = findActiveMafiaByDM(pointsKey(sender));
        if (!found || found.player.role !== 'تاجر بشر') {
          await sock.sendMessage(from, { text: '⚠️ ما عندك دور تاجر بشر نشط حالياً بأي لعبة.' });
          return;
        }
        const idx = parseInt(args[0], 10) - 1;
        const alive = mafiaAliveList(found.game);
        if (isNaN(idx) || !alive[idx]) {
          await sock.sendMessage(from, { text: '⚠️ رقم غير صحيح. استخدم الترقيم يلي وصلك بالقروب.' });
          return;
        }
        if (alive[idx].jid === sender) {
          await sock.sendMessage(from, { text: '⚠️ ما فيك تهرّب حالك!' });
          return;
        }
        found.game.nightActions.traffickerJid = sender;
        found.game.nightActions.traffickerTarget = alive[idx].jid;
        const traffickerCount = found.player.trafficked || 0;
        await sock.sendMessage(from, {
          text: `🕴️ حددت هدف التهريب: @${alive[idx].jid.split('@')[0]}... رح تعرف نتيجة العملية آخر الليل. (عملياتك الناجحة لهلق: ${traffickerCount}/3)`,
        });
      }

      // ==== 🧍 لعبة مافيا فردية: تلعب لحالك ضد لاعبين آليين، وأي حدا بالقروب فيه ينضم ويلعب معاك ====
      else if (command === '.مافيا_فردي') {
        if (mafiaGames[from]) {
          await sock.sendMessage(from, { text: '⚠️ في لعبة مافيا شغالة أصلاً هون. أنهيها أو الغيها قبل ما تبدأ وحدة جديدة.' });
          return;
        }
        let total = parseInt(args[0], 10);
        if (isNaN(total)) total = 6;
        total = Math.max(4, Math.min(10, total));

        mafiaGames[from] = {
          phase: 'lobby',
          players: [{ jid: sender, alive: true }],
          hostSender: sender,
          solo: true,
          maxPlayers: total,
        };

        if (!isGroup) {
          // ==== بالخاص محدا تاني فيه ينضم، فنبلش فوراً بلا انتظار ====
          await sock.sendMessage(from, {
            text:
              `🧍 ✦ *بدأت لعبة مافيا فردية!* ✦\n\n` +
              `عدد اللاعبين: ${total} (أنت + ${total - 1} لاعبين آليين 🤖)\n\n` +
              `رح توصلك تفاصيل دورك هون مباشرة، وقراراتك بنفس أوامر لعبة المافيا العادية (.قتل .حماية .تحقيق .قنص .تهريب بالليل، و.تصويت بالنهار).\n\n` +
              `يلا نبدأ...`,
          });
          await finalizeSoloLobby(sock, from);
        } else {
          await sock.sendMessage(from, {
            text:
              `🧍 ✦ *بدأت لعبة مافيا فردية!* ✦\n\n` +
              `عدد اللاعبين المطلوب: ${total}\n\n` +
              `أي حدا بالقروب حابب يلعب معاك فيه ينضم خلال 45 ثانية بأمر *.مافيا_انضم*، والمقاعد الفاضية رح تتعبى بلاعبين آليين 🤖 أوتوماتيكياً.\n` +
              `⚡ إذا بدك تبلش فوراً وما بدك تستنى الـ45 ثانية، اكتب *.مافيا_بدء_الآن* (بس المضيف يقدر).\n\n` +
              `👤 انضم: @${sender.split('@')[0]}`,
            mentions: [sender],
          });
          setTimeout(() => finalizeSoloLobby(sock, from), 45000);
        }
      }

      // ==== ⚡ المضيف يبلش اللعبة الفردية فوراً بدون ما ينتظر الـ45 ثانية كاملة ====
      else if (command === '.مافيا_بدء_الآن') {
        const game = mafiaGames[from];
        if (!game || game.phase !== 'lobby' || !game.solo) {
          await sock.sendMessage(from, { text: '⚠️ ما في لعبة مافيا فردية بمرحلة الانتظار حالياً.' });
          return;
        }
        if (sender !== game.hostSender) {
          await sock.sendMessage(from, { text: '⛔ بس اللي بدأ اللعبة (المضيف) يقدر يبلشها قبل الوقت.' });
          return;
        }
        await sock.sendMessage(from, { text: '⚡ المضيف قرر يبلش فوراً!' });
        await finalizeSoloLobby(sock, from);
      }

      // ==== 🗳️ التصويت النهاري بلعبة المافيا (بالقروب) ====
      else if (command === '.تصويت' && isGroup && mafiaGames[from] && mafiaGames[from].phase === 'day') {
        const game = mafiaGames[from];
        const voter = game.players.find((p) => p.jid === sender && p.alive);
        if (!voter) {
          await sock.sendMessage(from, { text: '⚠️ أنت مش لاعب حي بهاد اللعبة.' });
          return;
        }

        const alive = mafiaAliveList(game);
        let target = null;

        // ==== يقبل التصويت برقم من الترقيم، أو بمنشن مباشر للاعب ====
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        if (mentioned && mentioned.length > 0) {
          target = alive.find((p) => p.jid === mentioned[0]);
        } else {
          const idx = parseInt(args[0], 10) - 1;
          if (!isNaN(idx) && alive[idx]) target = alive[idx];
        }

        if (!target) {
          await sock.sendMessage(from, { text: '⚠️ رقم غير صحيح. استخدم الترقيم يلي بالرسالة، أو اعمل منشن مباشر للاعب.' });
          return;
        }

        if (target.jid === sender) {
          await sock.sendMessage(from, { text: '⚠️ ما فيك تصوّت لحالك.' });
          return;
        }

        const changedVote = !!game.votes[sender];
        game.votes[sender] = target.jid;

        const votedCount = Object.keys(game.votes).length;
        const totalAlive = alive.length;

        await sock.sendMessage(from, {
          text:
            `🗳️ ${changedVote ? '(غيّر صوته) ' : ''}@${sender.split('@')[0]} صوّت لـ @${target.jid.split('@')[0]}\n` +
            `📊 صوّت لهلق: ${votedCount}/${totalAlive}\n` +
            `↩️ *.الغاء_تصويت* لسحب صوتك`,
          mentions: [sender, target.jid],
        });

        // ==== لو كل اللاعبين الأحياء صوّتوا، نحسم النتيجة فوراً بلا انتظار الـ90 ثانية ====
        if (votedCount >= totalAlive) {
          await resolveMafiaDay(sock, from);
        }
      }

      // ==== ↩️ سحب/إلغاء صوتك بمرحلة النهار ====
      else if (command === '.الغاء_تصويت' && isGroup && mafiaGames[from] && mafiaGames[from].phase === 'day') {
        const game = mafiaGames[from];
        const voter = game.players.find((p) => p.jid === sender && p.alive);
        if (!voter) {
          await sock.sendMessage(from, { text: '⚠️ أنت مش لاعب حي بهاد اللعبة.' });
          return;
        }
        if (!game.votes[sender]) {
          await sock.sendMessage(from, { text: '⚠️ أنت أصلاً ما صوّتّ.' });
          return;
        }
        delete game.votes[sender];
        await sock.sendMessage(from, { text: `↩️ @${sender.split('@')[0]} سحب صوته.`, mentions: [sender] });
      }

      // ==== 💍 طلب زواج افتراضي لشخص آخر ====
      else if (command === '.زواج') {
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;

        // ==== 🎰 ما في منشن؟ زواج عشوائي للمرح: البوت بيختار شخص عشوائي من القروب ويزوجهم فوراً ====
        if (!mentioned || mentioned.length === 0) {
          if (!isGroup) {
            await sock.sendMessage(from, { text: '⚠️ الزواج العشوائي يشتغل بالقروبات بس. لتحديد شخص: .زواج @شخص' });
            return;
          }
          const senderKey = pointsKey(sender);
          if (marriages[senderKey]) {
            await sock.sendMessage(from, { text: `⚠️ أنت متزوج أصلاً من @${marriages[senderKey].spouse}، اعمل .طلاق الأول.` });
            return;
          }

          let groupMeta;
          try {
            groupMeta = await sock.groupMetadata(from);
          } catch (e) {
            await sock.sendMessage(from, { text: '❌ ما قدرت أجيب أعضاء القروب.' });
            return;
          }

          const candidates = groupMeta.participants.filter((p) => {
            if (p.id === sock.user.id) return false; // استثني البوت نفسه
            const key = pointsKey(p.id);
            return key !== senderKey && !marriages[key]; // استثني نفسك وأي حدا متزوج أصلاً
          });

          if (candidates.length === 0) {
            await sock.sendMessage(from, { text: '😅 ما لقيت حدا فاضي (غير متزوج) بالقروب أزوجك فيه.' });
            return;
          }

          const picked = candidates[Math.floor(Math.random() * candidates.length)];
          const pickedJid = picked.id;
          const pickedKey = pointsKey(pickedJid);
          const since = Date.now();
          marriages[senderKey] = { spouse: pickedKey, since };
          marriages[pickedKey] = { spouse: senderKey, since };
          saveMarriages();

          await sock.sendMessage(from, {
            text: buildFancyCard(
              '🎰',
              'زواج عشوائي!',
              `البوت دار على القروب واختارلك...\n\n` +
                `@${sender.split('@')[0]} 💍 @${pickedJid.split('@')[0]}\n\n` +
                `مبروك! عقبال دايم 🤍`
            ),
            mentions: [sender, pickedJid],
          });
          return;
        }

        const target = mentioned[0];
        const senderKey = pointsKey(sender);
        const targetKey = pointsKey(target);

        if (targetKey === senderKey) {
          await sock.sendMessage(from, { text: '⚠️ ما فيك تتزوج حالك 😅' });
          return;
        }
        if (marriages[senderKey]) {
          await sock.sendMessage(from, { text: `⚠️ أنت متزوج أصلاً من @${marriages[senderKey].spouse}، اعمل .طلاق الأول.` });
          return;
        }
        if (marriages[targetKey]) {
          await sock.sendMessage(from, { text: '⚠️ الشخص هاد متزوج أصلاً.' });
          return;
        }
        const existing = pendingProposals[targetKey];
        if (existing && existing.expiresAt > Date.now()) {
          await sock.sendMessage(from, { text: '⚠️ في طلب زواج معلّق أصلاً لهاد الشخص، استنى يرد عليه.' });
          return;
        }
        pendingProposals[targetKey] = { fromJid: sender, fromKey: senderKey, expiresAt: Date.now() + PROPOSAL_TIMEOUT_MS };
        await sock.sendMessage(from, {
          text: buildFancyCard(
            '💍',
            'طلب زواج!',
            `@${sender.split('@')[0]} طلب يتزوج @${target.split('@')[0]} 💌`,
            'للموافقة: *.قبول_الزواج*\nللرفض: *.رفض_الزواج*\n⏰ عندك 60 ثانية.'
          ),
          mentions: [sender, target],
        });
        setTimeout(() => {
          if (pendingProposals[targetKey] && pendingProposals[targetKey].fromKey === senderKey) {
            delete pendingProposals[targetKey];
          }
        }, PROPOSAL_TIMEOUT_MS);
      }

      // ==== 💍 الموافقة على طلب زواج معلّق ====
      else if (command === '.قبول_الزواج') {
        const senderKey = pointsKey(sender);
        const proposal = pendingProposals[senderKey];
        if (!proposal || proposal.expiresAt < Date.now()) {
          await sock.sendMessage(from, { text: '⚠️ ما في طلب زواج معلّق إلك حالياً.' });
          return;
        }
        if (marriages[senderKey] || marriages[proposal.fromKey]) {
          delete pendingProposals[senderKey];
          await sock.sendMessage(from, { text: '⚠️ حدا من الطرفين صار متزوج قبل ما توافق.' });
          return;
        }
        const since = Date.now();
        marriages[senderKey] = { spouse: proposal.fromKey, since };
        marriages[proposal.fromKey] = { spouse: senderKey, since };
        saveMarriages();
        delete pendingProposals[senderKey];
        await sock.sendMessage(from, {
          text: buildFancyCard(
            '💒',
            'مبروك الزواج!',
            `@${proposal.fromJid.split('@')[0]} 💍 @${sender.split('@')[0]}\n\nعقبال دايم! 🤍`
          ),
          mentions: [proposal.fromJid, sender],
        });
      }

      // ==== 💔 رفض طلب زواج معلّق ====
      else if (command === '.رفض_الزواج') {
        const senderKey = pointsKey(sender);
        const proposal = pendingProposals[senderKey];
        if (!proposal || proposal.expiresAt < Date.now()) {
          await sock.sendMessage(from, { text: '⚠️ ما في طلب زواج معلّق إلك حالياً.' });
          return;
        }
        delete pendingProposals[senderKey];
        await sock.sendMessage(from, {
          text: `💔 @${sender.split('@')[0]} رفض طلب الزواج من @${proposal.fromJid.split('@')[0]}.`,
          mentions: [sender, proposal.fromJid],
        });
      }

      // ==== 💔 طلاق الشريك الحالي ====
      else if (command === '.طلاق') {
        const senderKey = pointsKey(sender);
        const spouseKey = getSpouseKey(sender);
        if (!spouseKey) {
          await sock.sendMessage(from, { text: '⚠️ أنت مش متزوج أصلاً.' });
          return;
        }
        delete marriages[senderKey];
        delete marriages[spouseKey];
        saveMarriages();
        const spouseJid = `${spouseKey}@s.whatsapp.net`;
        await sock.sendMessage(from, {
          text: buildFancyCard('💔', 'تم الطلاق', `@${sender.split('@')[0]} وانفصل عن @${spouseKey} رسمياً.`),
          mentions: [sender, spouseJid],
        });
      }

      // ==== 💑 عرض معلومات الزواج ====
      else if (command === '.زوجي' || command === '.شريكي') {
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        const target = mentioned && mentioned.length > 0 ? mentioned[0] : sender;
        const entry = marriages[pointsKey(target)];
        if (!entry) {
          await sock.sendMessage(from, {
            text: target === sender ? '💔 أنت مش متزوج حالياً. تزوج بأمر .زواج @شخص' : '💔 هاد الشخص مش متزوج حالياً.',
            mentions: target === sender ? [] : [target],
          });
          return;
        }
        const daysMarried = Math.floor((Date.now() - entry.since) / (1000 * 60 * 60 * 24));
        const spouseJid = `${entry.spouse}@s.whatsapp.net`;
        await sock.sendMessage(from, {
          text: `💑 ✦ @${target.split('@')[0]} متزوج من @${entry.spouse} ✦\n💍 منذ *${daysMarried}* يوم`,
          mentions: [target, spouseJid],
        });
      }

      // ==== فحص إجابات الألعاب (تخمين الرقم / الأسئلة الثقافية) ====
      else {
        const plainText = text.trim();

        // 💎 لعبة صراحة: أي رد من صاحب الدور يُحسب إجابة، وينقل الدور تلقائي
        if (
          sincerityGames[from] &&
          sincerityGames[from].active &&
          plainText.length > 0 &&
          !plainText.startsWith('.') &&
          sender === sincerityGames[from].players[sincerityGames[from].turn]
        ) {
          const newTotal = await awardPointsWithAchievement(sock, from, sender, 8);
          await sock.sendMessage(from, {
            text:
              `💎 ✦ *إجابة موثّقة!* ✦\n` +
              `🙌 شكراً على صراحتك يا @${sender.split('@')[0]}\n` +
              `🏅 +8 نقطة (المجموع: ${newTotal})`,
            mentions: [sender],
          });
          await advanceSincerityTurn(sock, from);
        }

        // ⭕❌ حركة بلعبة اكس أو (رقم الخانة مباشرة، بدون أمر .حرك)
        else if (
          xoGames[from] &&
          /^\d$/.test(plainText) &&
          (pointsKey(sender) === pointsKey(xoGames[from].p1) || pointsKey(sender) === pointsKey(xoGames[from].p2))
        ) {
          await applyXoMove(sock, from, sender, parseInt(plainText, 10));
        }

        // 🎯 تخمين حرف بلعبة المشنقة (حرف عربي واحد بس)
        else if (
          hangmanGames[from] &&
          /^[ابتثجحخدذرزسشصضطظعغفقكلمنهويأإآءئؤةى]$/.test(plainText)
        ) {
          const game = hangmanGames[from];
          const letter = normalizeArabicChar(plainText);

          if (!game.guessed.has(letter) && !game.wrong.has(letter)) {
            game.lastActionAt = Date.now();
            const senderKey = pointsKey(sender);
            const isCorrect = game.word.split('').some((ch) => normalizeArabicChar(ch) === letter);

            if (isCorrect) {
              game.guessed.add(letter);
              game.contributors[senderKey] = (game.contributors[senderKey] || 0) + 1;

              if (isHangmanWordComplete(game.word, game.guessed)) {
                const finalTotal = await awardPointsWithAchievement(sock, from, sender, 20);
                const wordFinal = game.word;
                delete hangmanGames[from];
                await sock.sendMessage(from, {
                  text: buildFancyCard(
                    '🎉',
                    'فزتوا! المشنقة انحلّت',
                    `🔤 الكلمة كانت: *${wordFinal}*\n\n` +
                      `🏆 @${sender.split('@')[0]} كمّل الكلمة! (+20 نقطة، المجموع: ${finalTotal})`
                  ),
                  mentions: [sender],
                });
              } else {
                const newTotal = await awardPointsWithAchievement(sock, from, sender, 5);
                await sendHangmanBoard(
                  sock,
                  from,
                  game,
                  `✅ @${sender.split('@')[0]} خمّن حرف *${letter}* صح! (+5 نقطة، المجموع: ${newTotal})\n\n`
                );
              }
            } else {
              game.wrong.add(letter);
              if (game.wrong.size >= game.maxWrong) {
                const wordFinal = game.word;
                delete hangmanGames[from];
                await sock.sendMessage(from, {
                  text: buildFancyCard(
                    '💀',
                    'خسرتوا! المشنقة خلصت',
                    `${HANGMAN_STAGES[HANGMAN_MAX_WRONG]}\n\n🔤 الكلمة كانت: *${wordFinal}*`
                  ),
                });
              } else {
                await sendHangmanBoard(sock, from, game, `❌ @${sender.split('@')[0]} خمّن حرف *${letter}* غلط!\n\n`);
              }
            }
          }
        }

        // 🔗 كلمة جديدة بلعبة سلسلة الكلمات (لازم تبلش بآخر حرف من الكلمة اللي قبلها + ما تكون مكررة)
        else if (wordChainGames[from] && !plainText.startsWith('.')) {
          const normalized = normalizeArabicWord(plainText);
          if (isArabicWord(normalized) && normalized.length >= 2) {
            const game = wordChainGames[from];
            const senderKey = pointsKey(sender);

            if (normalized[0] !== game.lastLetter) {
              await sock.sendMessage(from, {
                text: `⚠️ لازم الكلمة تبلش بحرف *"${game.lastLetter}"*، جرب مرة تانية.`,
              });
            } else if (game.usedWords.has(normalized)) {
              await sock.sendMessage(from, {
                text: `⚠️ الكلمة "${plainText.trim()}" انكتبت قبل هيك بنفس الجولة، جرب كلمة تانية.`,
              });
            } else {
              game.usedWords.add(normalized);
              game.lastLetter = normalized.slice(-1);
              game.round += 1;
              game.scores[senderKey] = (game.scores[senderKey] || 0) + 1;
              game.roundId = Date.now();
              const newTotal = await awardPointsWithAchievement(sock, from, sender, 5);

              await sock.sendMessage(from, {
                text:
                  `✅ @${sender.split('@')[0]}: *${plainText.trim()}* صح! (+5 نقطة، المجموع: ${newTotal})\n` +
                  `➡️ الكلمة الجاية تبلش بحرف *"${game.lastLetter}"*`,
                mentions: [sender],
              });

              scheduleWordChainTimeout(sock, from, game.roundId);
            }
          }
        }

        // تخمين الرقم
        else if (numberGames[from] && /^\d+$/.test(plainText)) {
          const guess = parseInt(plainText, 10);
          const game = numberGames[from];
          game.attempts++;

          if (guess === game.target) {
            // مكافأة أكبر كل ما حليتها بمحاولات أقل (اللعبة صارت أصعب: مدى أوسع ومحاولات محدودة)
            const bonus = game.attempts <= 3 ? 25 : game.attempts <= 5 ? 20 : 15;
            const newTotal = await awardPointsWithAchievement(sock, from, sender, bonus);
            await sock.sendMessage(from, {
              text: `🎉 ✦ *صح! الرقم كان ${game.target}* ✦\nحلّيتها بـ ${game.attempts} محاولة 👏\n\n🏅 +${bonus} نقطة (المجموع: ${newTotal})`,
            });
            delete numberGames[from];
            await continueEventIfActive(sock, from);
          } else if (game.maxAttempts && game.attempts >= game.maxAttempts) {
            await sock.sendMessage(from, {
              text: `😅 ✦ *خلصت المحاولات!* ✦\nالرقم كان: *${game.target}*\nجرب مرة ثانية بـ .تخمين`,
            });
            delete numberGames[from];
            await continueEventIfActive(sock, from);
          } else {
            const remaining = game.maxAttempts ? game.maxAttempts - game.attempts : null;
            const remainingNote = remaining !== null ? ` (باقيلك ${remaining} محاولات)` : '';
            if (guess < game.target) {
              await sock.sendMessage(from, { text: `📈 أكبر شوي! جرب رقم أعلى.${remainingNote}` });
            } else {
              await sock.sendMessage(from, { text: `📉 أصغر شوي! جرب رقم أوطى.${remainingNote}` });
            }
          }
        }

        // الأسئلة الثقافية
        else if (quizGames[from] && plainText.toLowerCase() === quizGames[from].answer) {
          const newTotal = await awardPointsWithAchievement(sock, from, sender, 10);
          await sock.sendMessage(from, {
            text: `🎉 ✦ *إجابة صحيحة!* ✦\nمبروك 👏\n\n🏅 +10 نقطة (المجموع: ${newTotal})`,
          });
          delete quizGames[from];
          await continueEventIfActive(sock, from);
        }

        // سباق الكتابة السريعة
        else if (speedGames[from] && plainText === speedGames[from].word) {
          const winner = isGroup ? `@${sender.split('@')[0]}` : 'أنت';
          const newTotal = await awardPointsWithAchievement(sock, from, sender, 10);
          await sock.sendMessage(from, {
            text: `🏆 ✦ *فاز ${winner} بالسباق!* ✦\n\n🏅 +10 نقطة (المجموع: ${newTotal})`,
            mentions: isGroup ? [sender] : [],
          });
          delete speedGames[from];
          await continueEventIfActive(sock, from);
        }

        // الحساب السريع
        else if (mathGames[from] && plainText === mathGames[from].answer) {
          const winner = isGroup ? `@${sender.split('@')[0]}` : 'أنت';
          const newTotal = await awardPointsWithAchievement(sock, from, sender, 10);
          await sock.sendMessage(from, {
            text: `🎉 ✦ *إجابة صحيحة! أحسنت ${winner}* ✦\n\n🏅 +10 نقطة (المجموع: ${newTotal})`,
            mentions: isGroup ? [sender] : [],
          });
          delete mathGames[from];
          await continueEventIfActive(sock, from);
        }

        // فك الكلمة
        else if (scrambleGames[from] && plainText.trim() === scrambleGames[from].word) {
          const winner = isGroup ? `@${sender.split('@')[0]}` : 'أنت';
          const newTotal = await awardPointsWithAchievement(sock, from, sender, 10);
          await sock.sendMessage(from, {
            text: `🎉 ✦ *صح! فكيتها يا ${winner}* ✦\n\n🏅 +10 نقطة (المجموع: ${newTotal})`,
            mentions: isGroup ? [sender] : [],
          });
          delete scrambleGames[from];
          await continueEventIfActive(sock, from);
        }

        // لغز
        else if (riddleGames[from] && plainText.trim() === riddleGames[from].answer) {
          const winner = isGroup ? `@${sender.split('@')[0]}` : 'أنت';
          const newTotal = await awardPointsWithAchievement(sock, from, sender, 15);
          await sock.sendMessage(from, {
            text: `🎉 ✦ *صح! أحسنت ${winner}* ✦\n\n🏅 +15 نقطة (المجموع: ${newTotal})`,
            mentions: isGroup ? [sender] : [],
          });
          delete riddleGames[from];
          await continueEventIfActive(sock, from);
        }

        // صح أو خطأ
        else if (trueFalseGames[from] && plainText.trim() === trueFalseGames[from].answer) {
          const winner = isGroup ? `@${sender.split('@')[0]}` : 'أنت';
          const newTotal = await awardPointsWithAchievement(sock, from, sender, 5);
          await sock.sendMessage(from, {
            text: `🎉 ✦ *صح! أحسنت ${winner}* ✦\n\n🏅 +5 نقطة (المجموع: ${newTotal})`,
            mentions: isGroup ? [sender] : [],
          });
          delete trueFalseGames[from];
          await continueEventIfActive(sock, from);
        }

        // تخمين الدولة
        else if (flagGames[from] && plainText.trim() === flagGames[from].name) {
          const winner = isGroup ? `@${sender.split('@')[0]}` : 'أنت';
          const newTotal = await awardPointsWithAchievement(sock, from, sender, 10);
          await sock.sendMessage(from, {
            text: `🎉 ✦ *صح! أحسنت ${winner}* ✦\n\n🏅 +10 نقطة (المجموع: ${newTotal})`,
            mentions: isGroup ? [sender] : [],
          });
          delete flagGames[from];
          await continueEventIfActive(sock, from);
        }

        // إكمال المثل
        else if (proverbGames[from] && plainText.trim() === proverbGames[from].answer) {
          const winner = isGroup ? `@${sender.split('@')[0]}` : 'أنت';
          const newTotal = await awardPointsWithAchievement(sock, from, sender, 15);
          await sock.sendMessage(from, {
            text: `🎉 ✦ *صح! أحسنت ${winner}* ✦\n\n🏅 +15 نقطة (المجموع: ${newTotal})`,
            mentions: isGroup ? [sender] : [],
          });
          delete proverbGames[from];
          await continueEventIfActive(sock, from);
        }

        // خمن الشخصية
        else if (figureGames[from] && plainText.trim() === figureGames[from].answer) {
          const winner = isGroup ? `@${sender.split('@')[0]}` : 'أنت';
          const newTotal = await awardPointsWithAchievement(sock, from, sender, 15);
          await sock.sendMessage(from, {
            text: `🎉 ✦ *صح! أحسنت ${winner}* ✦\n\n🏅 +15 نقطة (المجموع: ${newTotal})`,
            mentions: isGroup ? [sender] : [],
          });
          delete figureGames[from];
          await continueEventIfActive(sock, from);
        }

        // الكلمة الناقصة
        else if (blankGames[from] && plainText.trim() === blankGames[from].answer) {
          const winner = isGroup ? `@${sender.split('@')[0]}` : 'أنت';
          const newTotal = await awardPointsWithAchievement(sock, from, sender, 10);
          await sock.sendMessage(from, {
            text: `🎉 ✦ *صح! أحسنت ${winner}* ✦\n\n🏅 +10 نقطة (المجموع: ${newTotal})`,
            mentions: isGroup ? [sender] : [],
          });
          delete blankGames[from];
          await continueEventIfActive(sock, from);
        }

        // تصنيف: نتحقق إن الكلمة تبدأ بالحرف الصحيح وطولها معقول (نثق بالفئة)
        else if (
          categoryGames[from] &&
          plainText.trim().length >= 2 &&
          plainText.trim()[0] === categoryGames[from].letter
        ) {
          const winner = isGroup ? `@${sender.split('@')[0]}` : 'أنت';
          const newTotal = await awardPointsWithAchievement(sock, from, sender, 10);
          await sock.sendMessage(from, {
            text: `🎉 ✦ *صح! أحسنت ${winner}* ✦\n\n🏅 +10 نقطة (المجموع: ${newTotal})`,
            mentions: isGroup ? [sender] : [],
          });
          delete categoryGames[from];
          await continueEventIfActive(sock, from);
        }

        // ✅ إجابة صحيحة على سؤال المبارزة = تفتح حركة (هجوم/دفاع/شفاء) بدل الهجوم التلقائي (لازم يكون دورك بالضبط)
        else if (
          duels[from] &&
          duels[from].pendingQuestion &&
          sender === duels[from][duels[from].turn] &&
          plainText.toLowerCase().trim() === duels[from].pendingQuestion.a
        ) {
          const duel = duels[from];
          const mySlot = duel.turn;
          const oppSlot = mySlot === 'p1' ? 'p2' : 'p1';
          const myJid = duel[mySlot];
          const oppJid = duel[oppSlot];

          duel.pendingQuestion = null; // نقفل السؤال فوراً (قبل أي await) حتى ما ياخذ حدا الجولة مرتين بنفس اللحظة
          duel.actionReady[mySlot] = true;

          const goldWon = Math.floor(Math.random() * 11) + 15; // 15-25 ذهب على الإجابة الصحيحة
          duel.gold[mySlot] += goldWon;

          const healNote = duel.heals[mySlot] >= DUEL_MAX_HEALS ? ' (خلصت مرات شفائك المجانية، بس تقدر تشتري جرعة)' : '';

          await sock.sendMessage(from, {
            text:
              `✅ ✦ *إجابة صحيحة يا @${myJid.split('@')[0]}!* ✦ 🪙 +${goldWon} ذهب (المجموع: ${duel.gold[mySlot]})\n\n` +
              `🎯 اختار حركتك الآن:\n` +
              `⚔️ *.هجوم* — يوجع @${oppJid.split('@')[0]}\n` +
              `🛡️ *.دفاع* — يصد نص الهجمة الجاية\n` +
              `💚 *.شفاء* — يرجعلك حياة${healNote}\n\n` +
              `⏰ عندك 30 ثانية تختار.`,
            mentions: [myJid, oppJid],
          });

          scheduleDuelActionTimeout(sock, from, mySlot, myJid, oppSlot);
        }
      }
    } catch (err) {
      console.log('❌ صار خطأ:', err.message);
    }
  });
}

// ==== 🛡 شبكة أمان: منع أي خطأ غير متوقع من إيقاف البوت بالكامل ====
// (مثلاً أخطاء فك التشفير من libsignal، شائعة وغير خطيرة، بس كانت توقف العملية)
// ==== 🚨 كمان بتنبه المالك مباشرة بالواتساب (مش بس بالتيرمينال)، بحد أقصى تنبيه كل 5 دقايق حتى ما يصير سبام لو الخطأ عم يتكرر بسرعة ====
async function notifyOwnerOfCrash(label, message) {
  console.log(`⚠️ ${label} (تم تجاهله والبوت مستمر):`, message);
  try {
    const now = Date.now();
    if (!globalSockRef || now - lastCrashAlertTime < 5 * 60 * 1000) return;
    lastCrashAlertTime = now;
    await globalSockRef.sendMessage(ADMINS[0], {
      text: `🚨 ✦ *تنبيه: صار خطأ غير متوقع بالبوت* ✦\n\n⚠️ ${label}\n📋 ${String(message).slice(0, 300)}\n\n✅ البوت تجاهل الخطأ ومستمر بالشغل عادي، بس هاد لأخذ العلم لو تكرر.`,
    });
  } catch (e) {
    // لو حتى إرسال التنبيه فشل (مثلاً الاتصال مقطوع)، منتجاهل بهدوء
  }
}
process.on('uncaughtException', (err) => {
  notifyOwnerOfCrash('خطأ غير متوقع', err.message);
});
process.on('unhandledRejection', (reason) => {
  notifyOwnerOfCrash('خطأ غير متوقع بوعد', reason && reason.message ? reason.message : reason);
});

// ==== 💾 حفظ آمن لكل البيانات قبل إغلاق البوت (Ctrl+C أو إيقاف عادي) — يمنع فقدان آخر التعديلات ====
function saveAllDataOnExit() {
  console.log('\n💾 جاري حفظ كل البيانات قبل الإغلاق...');
  try {
    saveJSON(BANNED_FILE, banned);
    saveJSON(PRAYER_FILE, prayerTimes);
    saveJSON(SALAWAT_FILE, salawatGroups);
    saveJSON(AZKAR_FILE, azkarGroups);
    saveJSON(WARN_FILE, warnings);
    saveJSON(PROTECTION_FILE, protectionSettings);
    saveJSON(GROUP_STATS_FILE, groupStats);
    saveJSON(POINTS_FILE, points);
    saveWeekly();
    saveJSON(SHOP_FILE, shop);
    saveAuctions();
    saveJSON(USAGE_FILE, commandUsage);
    saveAiUsage();
    saveBotSettings();
    saveReminders();
    saveMutes();
    saveSlowMode();
    saveJobs();
    saveStats();
    saveMarriages();
    saveDailyReward();
    console.log('✅ تم حفظ كل البيانات بنجاح. إلى اللقاء 👋');
  } catch (e) {
    console.log('⚠️ خطأ أثناء الحفظ النهائي:', e.message);
  }
  process.exit(0);
}
process.on('SIGINT', saveAllDataOnExit);
process.on('SIGTERM', saveAllDataOnExit);

startBotInstance();
