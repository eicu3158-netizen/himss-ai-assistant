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

  if (dateToken && cleanText(item.date) === dateToken) score += 10;

  if (q.includes('地址') || q.includes('地點') || q.includes('哪裡') || q.includes('在哪')) {
    if (cleanText(item.location)) score += 6;
    if (cleanText(item.localMap)) score += 6;
  }

  if (q.includes('會場') && (haystack.includes('HIMSS') || haystack.includes('GTC') || haystack.includes('會場'))) {
    score += 8;
  }

  const keywords = ['HIMSS', 'GTC', '餐', '晚餐', '午餐', '參訪', '住宿', '會議', '返台', '出發', '聖荷西', '晚宴', '接駁'];
  keywords.forEach((kw) => {
    if (q.includes(kw) && haystack.includes(kw)) score += 3;
  });

  return score;
}

function scoreTaskItem(item, question, dateToken) {
  let score = 0;
  const q = normalizeQuestion(question);
  const haystack = flattenSearchableText(item);

  if (dateToken && haystack.includes(dateToken)) score += 10;

  const keywords = ['返台', '回程', '返程', '出發', '搭機', '班機', '抵達', '聖荷西', '台灣', '桃園', 'TPE', 'SJC', 'San Jose'];
  keywords.forEach((kw) => {
    if (q.includes(kw) && haystack.includes(kw)) score += 4;
  });

  return score;
}

function scoreReferenceItem(item, question) {
  let score = 0;
  const q = normalizeQuestion(question);
  const haystack = flattenSearchableText(item);

  ['HIMSS', 'GTC', '手冊', '會場', '地址', '官方', '文件', '注意事項', '地圖'].forEach((kw) => {
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
    .slice(0, 25)
    .map(({ __score, ...rest }) => rest);

  const relevantTasks = taskData
    .map((item) => ({ ...item, __score: scoreTaskItem(item, q, dateToken) }))
    .filter((item) => item.__score > 0)
    .sort((a, b) => b.__score - a.__score)
    .slice(0, 20)
    .map(({ __score, ...rest }) => rest);

  const relevantRefs = referenceData
    .map((item) => ({ ...item, __score: scoreReferenceItem(item, q) }))
    .filter((item) => item.__score > 0)
    .sort((a, b) => b.__score - a.__score)
    .slice(0, 12)
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
        `${idx + 1}. 日期=${cleanText(item.date)}；時間=${cleanText(item.time)}；活動=${cleanText(item.activity)}；類型=${cleanText(item.activityType)}；分類=${cleanText(item.category)}；地點=${cleanText(item.location)}；地圖=${cleanText(item.localMap)}；成員=${cleanText(item.members)}；活動窗口=${cleanText(item.contact)}；交通=${cleanText(item.transitTime)}；備註=${cleanText(item.note)}；附件=${cleanText(item.attachmentUrl)}；官方連結=${cleanText(item.officialLink)}`
      );
    });
  }

  if (picked.relevantTasks.length) {
    lines.push('\n【最相關的班機 / 飲食資料】');
    picked.relevantTasks.forEach((item, idx) => {
      lines.push(
        `${idx + 1}. 姓名=${cleanText(item.name)}；班機=${cleanText(item.fly)}；飲食=${cleanText(item.diet)}；禁忌=${cleanText(item.foodsAvoid)}`
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
名稱固定為「秀傳AI小秘書」。

你的角色不是一般聊天機器人，而是：
「根據內部行程資料、班機資料、參考資料，提供精準、可執行、可直接使用的行程助理回答」。

你只能依據提供資料回答，不能自行用外部常識補資料。
如果資料沒有，就回答：
- 資料不足
- 目前資料未提供
- 目前資料中沒有找到明確資訊

====================
【最高優先規則】
====================

1. 若資料中已有 location、localMap、link、content、note、officialLink、attachmentUrl，
   你必須優先使用，不可忽略。
2. 只要資料內有地址或地點，不可說「尚未提供」。
3. 絕對不可自行臆測 HIMSS、GTC、餐廳、飯店、參訪地點的地址。
4. 若使用者問「在哪裡、地址、地圖、會場在哪、餐廳在哪、住宿在哪」，
   你必須先檢查 relevantTrips 與 relevantRefs 裡是否已有：
   - 地點
   - 地圖
   - 連結
   - 內容說明

====================
【回答規則】
====================

5. 一律使用繁體中文。
6. 先直接回答重點，不要先寫空泛開場白。
7. 回答要適合手機閱讀，段落短、條列清楚。
8. 若是名單類問題，直接列人名即可。
9. 若是行程類問題，要依時間順序列出。
10. 若是地址類問題，回答格式優先如下：
   - 項目名稱
   - 日期 / 時間（若有）
   - 地點 / 地址
   - 地圖連結（若有）
   - 補充說明（若有）

11. 若是班機類問題，回答格式優先如下：
   - 人員
   - 航班關鍵資訊
   - 出發 / 抵達 / 返台時間（若能從資料判讀）
   - 補充說明（若有）

12. 若是某日行程問題，回答格式優先如下：
   - 先寫日期
   - 然後逐條列出：
     時間｜活動名稱｜地點
   - 若有地圖連結，可最後補充「地圖連結：...」

13. 若是某人相關問題，優先綜合 relevantTrips、relevantTasks、mentionedPeople 作答。
14. 若同一題有多筆資料，優先整理，不要只挑一筆。
15. 不要輸出 markdown link 格式 [文字](網址)，直接寫：
   連結：https://...
16. 若找得到具體資料，不要回答「資料不足」。

====================
【特別判讀規則】
====================

17. 「行程」包含：車程、餐敘、會議、飛機、參訪、住宿。
18. 問「3/15行程」時，要列出該日全部相關行程，不可只抓單一活動。
19. 問「誰回台灣、誰返台、返程班機」時，優先看 relevantTasks 的 fly。
20. 問「誰從台灣出發、搭機出發」時，也優先看 relevantTasks 的 fly。
21. 問「某人何時抵達聖荷西」時，優先從 relevantTasks 的 fly 找：
   - 抵達
   - SJC
   - San Jose
   - 聖荷西

22. 可容忍常見錯字：
   - 晚歺 = 晚餐
   - 班雞 = 班機
   - 哪理 = 哪裡
   - 聖何西 = 聖荷西
   - 回台 = 返台

====================
【禁止事項】
====================

23. 禁止自行用一般網路常識補充會場地址。
24. 禁止忽略內部資料已經存在的地點與地圖欄位。
25. 禁止為了讓答案好看而捏造資訊。
26. 禁止只回答模糊描述，若資料中有明確地點就要寫出來。

====================
【回答品質要求】
====================

27. 回答要像專業旅程助理，不像閒聊機器人。
28. 條列要清楚，盡量避免一大段文字。
29. 若資料中同時有 location 與 map，請兩者都盡量保留。
30. 若資料已經足夠完整，請直接給結論，不要說「建議再查官方網站」。
`;

    const userPrompt = `
以下是根據問題預先篩選出的最相關資料，你必須優先根據這些資料回答。

${structuredHint}
`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.05,
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