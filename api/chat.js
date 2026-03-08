import OpenAI from 'openai';

function cleanText(value) {
  return String(value ?? '').trim();
}

function normalizeQuestion(text) {
  let q = cleanText(text);
  const rules = [
    [/晚歺|晩餐|晩歺/g, '晚餐'],
    [/午歺/g, '午餐'],
    [/班雞|班基|搬機/g, '班機'],
    [/哪理|那理|那裡/g, '哪裡'],
    [/聖何西|圣荷西|聖荷矽/g, '聖荷西'],
    [/回台灣|回台/g, '返台'],
    [/-/g, '/'],
  ];
  rules.forEach(([regex, replacement]) => {
    q = q.replace(regex, replacement);
  });
  return q;
}

function extractDateToken(question) {
  const q = normalizeQuestion(question);

  let match = q.match(/(20\d{2})\/(\d{1,2})\/(\d{1,2})/);
  if (match) {
    const yyyy = match[1];
    const mm = match[2].padStart(2, '0');
    const dd = match[3].padStart(2, '0');
    return `${yyyy}/${mm}/${dd}`;
  }

  match = q.match(/(^|[^0-9])(\d{1,2})\/(\d{1,2})(?!\d)/);
  if (match) {
    const mm = match[2].padStart(2, '0');
    const dd = match[3].padStart(2, '0');
    return `2026/${mm}/${dd}`;
  }

  return '';
}

function splitMembers(membersText) {
  return String(membersText ?? '')
    .split(/[\n、,，/;；]+/)
    .map((s) => cleanText(s))
    .filter(Boolean);
}

function flattenSearchableText(obj) {
  return Object.values(obj || {})
    .map((v) => cleanText(v))
    .filter(Boolean)
    .join(' | ');
}

function scoreTripItem(item, question, dateToken) {
  let score = 0;
  const q = normalizeQuestion(question);
  const haystack = flattenSearchableText(item);

  if (dateToken && item.date === dateToken) score += 8;

  if (q.includes('會場') && (haystack.includes('HIMSS') || haystack.includes('會場'))) score += 8;
  if (q.includes('地址') || q.includes('在哪') || q.includes('哪裡')) {
    if (item.location) score += 4;
    if (item.localMap) score += 4;
  }

  const keywords = ['HIMSS', 'GTC', '餐', '晚餐', '午餐', '參訪', '住宿', '會議', '返台', '出發', '聖荷西'];
  keywords.forEach((kw) => {
    if (q.includes(kw) && haystack.includes(kw)) score += 3;
  });

  return score;
}

function scoreTaskItem(item, question, dateToken) {
  let score = 0;
  const q = normalizeQuestion(question);
  const haystack = flattenSearchableText(item);

  if (dateToken && haystack.includes(dateToken)) score += 8;

  const keywords = ['返台', '回程', '返程', '出發', '搭機', '班機', '抵達', '聖荷西', '台灣', '桃園', 'TPE'];
  keywords.forEach((kw) => {
    if (q.includes(kw) && haystack.includes(kw)) score += 4;
  });

  return score;
}

function scoreReferenceItem(item, question) {
  let score = 0;
  const q = normalizeQuestion(question);
  const haystack = flattenSearchableText(item);

  ['HIMSS', 'GTC', '手冊', '會場', '地址', '官方', '文件', '注意事項'].forEach((kw) => {
    if (q.includes(kw) && haystack.includes(kw)) score += 3;
  });

  return score;
}

function pickRelevantContext(question, context) {
  const q = normalizeQuestion(question);
  const dateToken = extractDateToken(q);

  const tripData = Array.isArray(context?.tripData) ? context.tripData : [];
  const taskData = Array.isArray(context?.taskData) ? context.taskData : [];
  const referenceData = Array.isArray(context?.referenceData) ? context.referenceData : [];
  const peopleData = Array.isArray(context?.peopleData) ? context.peopleData : [];
  const prepData = Array.isArray(context?.prepData) ? context.prepData : [];

  const relevantTrips = tripData
    .map((item) => ({ ...item, __score: scoreTripItem(item, q, dateToken) }))
    .filter((item) => item.__score > 0)
    .sort((a, b) => b.__score - a.__score)
    .slice(0, 20)
    .map(({ __score, ...rest }) => rest);

  const relevantTasks = taskData
    .map((item) => ({ ...item, __score: scoreTaskItem(item, q, dateToken) }))
    .filter((item) => item.__score > 0)
    .sort((a, b) => b.__score - a.__score)
    .slice(0, 15)
    .map(({ __score, ...rest }) => rest);

  const relevantRefs = referenceData
    .map((item) => ({ ...item, __score: scoreReferenceItem(item, q) }))
    .filter((item) => item.__score > 0)
    .sort((a, b) => b.__score - a.__score)
    .slice(0, 10)
    .map(({ __score, ...rest }) => rest);

  const mentionedPeople = peopleData.filter((p) => q.includes(cleanText(p.name))).slice(0, 10);

  const relevantPrep =
    q.includes('禮品') || q.includes('準備') || q.includes('行前')
      ? prepData.slice(0, 20)
      : [];

  return {
    dateToken,
    relevantTrips,
    relevantTasks,
    relevantRefs,
    mentionedPeople,
    relevantPrep,
  };
}

function buildStructuredHint(question, context, picked) {
  const q = normalizeQuestion(question);
  const lines = [];

  lines.push(`使用者問題：${q}`);
  if (picked.dateToken) lines.push(`問題中的日期：${picked.dateToken}`);

  if (picked.relevantTrips.length) {
    lines.push('\n【最相關的行程資料】');
    picked.relevantTrips.forEach((item, idx) => {
      lines.push(
        `${idx + 1}. 日期=${cleanText(item.date)}；時間=${cleanText(item.time)}；活動=${cleanText(item.activity)}；類型=${cleanText(item.activityType)}；分類=${cleanText(item.category)}；地點=${cleanText(item.location)}；地圖=${cleanText(item.localMap)}；成員=${cleanText(item.members)}；備註=${cleanText(item.note)}`
      );
    });
  }

  if (picked.relevantTasks.length) {
    lines.push('\n【最相關的班機 / 飲食資料】');
    picked.relevantTasks.forEach((item, idx) => {
      lines.push(
        `${idx + 1}. 姓名=${cleanText(item.name)}；班機=${cleanText(item.fly)}；diet=${cleanText(item.diet)}；foodsAvoid=${cleanText(item.foodsAvoid)}`
      );
    });
  }

  if (picked.relevantRefs.length) {
    lines.push('\n【最相關的參考資料】');
    picked.relevantRefs.forEach((item, idx) => {
      lines.push(
        `${idx + 1}. 項目=${cleanText(item.item)}；內容=${cleanText(item.content)}；連結=${cleanText(item.link)}`
      );
    });
  }

  if (picked.mentionedPeople.length) {
    lines.push('\n【問題中提到的人員】');
    picked.mentionedPeople.forEach((item, idx) => {
      lines.push(`${idx + 1}. 姓名=${cleanText(item.name)}；任務=${cleanText(item.task)}；備註=${cleanText(item.note)}`);
    });
  }

  if (picked.relevantPrep.length) {
    lines.push('\n【準備資料】');
    picked.relevantPrep.forEach((item, idx) => {
      lines.push(`${idx + 1}. ${JSON.stringify(item)}`);
    });
  }

  lines.push('\n【完整資料量摘要】');
  lines.push(`tripData 筆數=${Array.isArray(context?.tripData) ? context.tripData.length : 0}`);
  lines.push(`taskData 筆數=${Array.isArray(context?.taskData) ? context.taskData.length : 0}`);
  lines.push(`referenceData 筆數=${Array.isArray(context?.referenceData) ? context.referenceData.length : 0}`);
  lines.push(`peopleData 筆數=${Array.isArray(context?.peopleData) ? context.peopleData.length : 0}`);
  lines.push(`prepData 筆數=${Array.isArray(context?.prepData) ? context.prepData.length : 0}`);

  return lines.join('\n');
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { question, context } = req.body || {};

    if (!question) {
      return res.status(400).json({ error: 'Missing question' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY 未設定' });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const picked = pickRelevantContext(question, context || {});
    const structuredHint = buildStructuredHint(question, context || {}, picked);

    const systemPrompt = `
你是「秀傳醫療體系 2026 HIMSS+GTC 參訪團」網站中的 AI 助手。
你的名稱固定為「秀傳AI小秘書」。

你只能根據我提供給你的資料回答，不能使用外部常識自行補充。
如果資料中沒有，就明確回答「資料不足」或「目前資料未提供」。
絕對不要自行猜測 HIMSS 或 GTC 的地址、會場位置、交通資訊、餐廳位置。

請嚴格遵守：

一、資料優先
1. 只能依據提供資料回答。
2. 若資料有地址、location、localMap、link，優先引用該資料。
3. 如果使用者問「在哪裡、地址、地圖、會場位置」，請優先檢查：
   - relevantTrips 的 location
   - relevantTrips 的 localMap
   - relevantRefs 的 content / link
4. 若資料已有地址或地圖，不可說「尚未提供」。

二、行程判讀
5. 「行程」包含：車程、餐敘、會議、飛機、參訪、住宿。
6. 問某日行程時，要列出該日全部 relevantTrips，依時間排序描述。
7. 若 relevantTrips 已含 location，回答時請帶出地點。
8. 若 relevantTrips 已含 localMap，可在回答最後補一句「可參考地圖連結」。

三、班機判讀
9. 問返台、回台灣、返程、回程、搭機時，優先看 relevantTasks 的 fly。
10. 問誰從台灣出發，也優先看 relevantTasks 的 fly。
11. 問某人何時抵達聖荷西，要從 relevantTasks 的 fly 內找「抵達、SJC、San Jose、聖荷西」等線索。

四、回答格式
12. 一律用繁體中文。
13. 先直接回答，不要先長篇前言。
14. 使用條列，讓手機上容易閱讀。
15. 若有日期，盡量寫成 YYYY/MM/DD。
16. 若有地址、地點、地圖，請明確列出。
17. 不要輸出 markdown 連結格式 [文字](網址)，直接寫「連結：網址」即可。
18. 不要胡亂說「尚未提供」；只有真的沒有相關欄位時才能這樣說。

五、若是地址類問題，回答格式優先如下：
- 項目名稱
- 地點 / 地址
- 地圖連結（若有）
- 相關時間（若有）

六、若是行程類問題，回答格式優先如下：
- 日期
- 時間 + 活動名稱 + 地點
- 若有地圖則補充

七、若是名單類問題，直接列人名即可，不要多餘描述。
`;

    const userPrompt = `
以下是根據使用者問題先篩出的最相關資料，請你優先用這些資料回答，不可忽略其中已存在的地址、location、localMap、link。

${structuredHint}
`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const answer =
      completion?.choices?.[0]?.message?.content?.trim() || '目前模型未回傳內容。';

    return res.status(200).json({ answer });
  } catch (error) {
    console.error('API /api/chat error full =', error);

    return res.status(500).json({
      error:
        error?.message ||
        error?.response?.data?.error?.message ||
        'AI server error',
    });
  }
}