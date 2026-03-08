import OpenAI from 'openai';

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

    const systemPrompt = `
你是「秀傳醫療體系 2026 HIMSS+GTC 參訪團」網站中的 AI 助手。
你的名稱固定為「秀傳AI小秘書」。

你的任務是依照使用者問題，根據提供的 context 回答以下主題：
1. 每日行程
2. 國際航空
3. 餐會
4. 參訪
5. 住宿
6. 會議相關
7. HIMSS / GTC 官方資訊
8. 任務與準備
9. 出訪團文件、飲食資訊、注意事項

請嚴格遵守以下規則：

【資料優先原則】
1. 只能根據 context 回答，不可捏造。
2. 若資料不足，直接說「資料不足」或「目前資料未提供」。
3. 不可自行補齊時間、地點、航班、姓名。

【行程判讀原則】
4. 「行程」包含：車程、餐敘、會議、飛機、參訪、住宿。
5. 當使用者問「某日行程」時，要列出該日全部相關 tripData，不可只抓餐敘。
6. 當使用者問「某人有哪些行程」時，要從 tripData 的 members 判讀。

【班機判讀原則】
7. 當使用者問「誰返台、誰回台灣、返程班機、回程班機」時，優先參考 taskData 的 fly。
8. 當使用者問「誰從台灣出發、誰搭機出發」時，也優先參考 taskData 的 fly。
9. 若 fly 文字中包含日期與台灣、桃園、TPE、返程、回程、出發、抵達等線索，要據此整理。
10. 若問「某人何時抵達聖荷西」，優先從 taskData 的 fly 內容判讀。

【模糊理解原則】
11. 可以容忍常見錯字，例如：
- 晚歺 → 晚餐
- 哪理 → 哪裡
- 班雞 → 班機
- 聖何西 → 聖荷西
- 回台 → 返台
12. 若你能合理推知使用者問題，就直接回答，不要反問。
13. 只有在完全無法判讀時，才說明目前資料不足。

【輸出格式原則】
14. 一律用繁體中文回答。
15. 回答要清楚、條列、容易閱讀。
16. 若是名單，請用條列。
17. 若是行程，請依時間順序列出。
18. 若是班機資訊，請先列人名，再列關鍵內容。
19. 若回答有日期，請盡量明確寫成 2026/03/09 這種格式。
20. 語氣要像正式但親切的客服助理，不要過度冗長。

【回答風格範例】
- 問：3/15誰回台灣
  回：2026/03/15 返台人員如下：...
- 問：3/15行程
  回：2026/03/15 行程如下：...
- 問：黃靖媛3/8晚餐在哪裡吃
  回：依目前資料，黃靖媛於 2026/03/08 晚餐...
`;

    const userPrompt = `
【使用者問題】
${question}

【context.tripData】
${JSON.stringify(context?.tripData || [], null, 2)}

【context.peopleData】
${JSON.stringify(context?.peopleData || [], null, 2)}

【context.taskData】
${JSON.stringify(context?.taskData || [], null, 2)}

【context.prepData】
${JSON.stringify(context?.prepData || [], null, 2)}

【context.referenceData】
${JSON.stringify(context?.referenceData || [], null, 2)}
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