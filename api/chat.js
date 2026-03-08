import OpenAI from 'openai';

function cleanText(value) {
  return String(value ?? '').replace(/^\ufeff/, '').trim();
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

function getValue(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && cleanText(obj[key]) !== '') {
      return cleanText(obj[key]);
    }
  }
  return '';
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

function normalizeDate(rawDate) {
  const cleaned = cleanText(rawDate).replace(/[.\-]/g, '/');
  if (!cleaned) return '';
  const match = cleaned.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return cleaned;
  return `${match[1]}/${match[2].padStart(2, '0')}/${match[3].padStart(2, '0')}`;
}

function splitMembers(membersText) {
  if (!membersText) return [];
  return String(membersText)
    .split(/[\n、,，/;；]+/)
    .map((name) => cleanText(name))
    .filter(Boolean);
}

function includesMember(membersText, selectedMember) {
  if (!selectedMember) return true;
  return splitMembers(membersText).some(
    (name) => name === selectedMember || name.includes(selectedMember) || selectedMember.includes(name)
  );
}

function extractFirstUrl(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  const match = raw.match(/https?:\/\/[^\s]+|www\.[^\s]+/i);
  return match ? match[0] : '';
}

function normalizeLink(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  const extracted = extractFirstUrl(raw) || raw;
  if (/^https?:\/\//i.test(extracted)) return extracted.trim();
  if (/^www\./i.test(extracted)) return `https://${extracted.trim()}`;
  return '';
}

function looksLikeGoogleMap(value) {
  const raw = cleanText(value);
  const link = normalizeLink(raw);
  return /google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google/i.test(link);
}

function buildGoogleMapSearchUrl(keyword) {
  const text = cleanText(keyword);
  if (!text) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
}

function mapTripItem(row) {
  const rawLocation = getValue(row, ['location']);
  const rawOfficialLink = getValue(row, ['officialLink']);
  const rawLinkUrl = getValue(row, ['linkUrl']);
  const rawLocalMap = getValue(row, ['localMap', 'localmap', 'mapLink']);

  const locationHref = normalizeLink(rawLocation);
  const officialHref = normalizeLink(rawOfficialLink);
  const linkHref = normalizeLink(rawLinkUrl);
  const localMapHref = normalizeLink(rawLocalMap);

  const locationIsMap = locationHref && looksLikeGoogleMap(rawLocation);
  const officialIsMap = officialHref && looksLikeGoogleMap(rawOfficialLink);
  const linkIsMap = linkHref && looksLikeGoogleMap(rawLinkUrl);

  return {
    category: getValue(row, ['category']),
    activityType: getValue(row, ['activityType']),
    date: normalizeDate(getValue(row, ['date'])),
    time: getValue(row, ['time']),
    activity: getValue(row, ['activity']),
    location: locationIsMap ? '' : rawLocation,
    members: getValue(row, ['members']),
    contact: getValue(row, ['contact']),
    transitTime: getValue(row, ['transitTime']),
    note: getValue(row, ['note']),
    officialLink: rawOfficialLink,
    officialLinkHref: !officialIsMap ? officialHref : '',
    linkUrl: rawLinkUrl,
    linkUrlHref: !linkIsMap ? linkHref : '',
    localMap: rawLocalMap,
    localMapHref:
      localMapHref ||
      (locationIsMap ? locationHref : '') ||
      (officialIsMap ? officialHref : '') ||
      (linkIsMap ? linkHref : '') ||
      (rawLocation ? buildGoogleMapSearchUrl(rawLocation) : ''),
    attachmentUrl: getValue(row, ['attachmentUrl']),
  };
}

function mapTaskItem(row) {
  return {
    name: getValue(row, ['name']),
    fly: getValue(row, ['fly']),
    diet: getValue(row, ['diet']),
    foodsAvoid: getValue(row, ['foodsAvoid', 'foods avoid']),
  };
}

function mapReferenceItem(row) {
  return {
    item: getValue(row, ['item', '項目']),
    link: getValue(row, ['link', '連結']),
    linkHref: normalizeLink(getValue(row, ['link', '連結'])),
    content: getValue(row, ['content', '內容', '摘要', 'note']),
  };
}

function mapPeopleItem(row) {
  return {
    name: getValue(row, ['name']),
    englishName: getValue(row, ['englishName']),
    task: getValue(row, ['task']),
    phone: getValue(row, ['phone']),
    note: getValue(row, ['note']),
  };
}

function flattenSearchableText(obj) {
  return Object.values(obj || {})
    .map((v) => cleanText(v))
    .filter(Boolean)
    .join(' | ');
}

function findBestMemberInQuestion(question, members) {
  const q = normalizeQuestion(question);
  const exact = members.find((name) => q.includes(name));
  if (exact) return exact;

  let bestName = '';
  let bestScore = 0;

  members.forEach((name) => {
    const chars = [...name];
    const hitCount = chars.filter((ch) => q.includes(ch)).length;
    const score = chars.length ? hitCount / chars.length : 0;
    if (score > bestScore) {
      bestScore = score;
      bestName = name;
    }
  });

  return bestScore >= 0.66 ? bestName : '';
}

function sortByDateTime(a, b) {
  const aKey = `${a.date || ''} ${a.time || ''}`;
  const bKey = `${b.date || ''} ${b.time || ''}`;
  return aKey.localeCompare(bKey, 'zh-Hant');
}

function formatTripLine(item) {
  const time = cleanText(item.time) || '時間未填';
  const activity = cleanText(item.activity) || '未命名行程';
  const location = cleanText(item.location);
  return `- ${time}｜${activity}${location ? `｜${location}` : ''}`;
}

function formatLocationBlock(item) {
  const lines = [];
  lines.push(`- 項目：${cleanText(item.activity) || '未命名活動'}`);
  if (item.date || item.time) lines.push(`  日期時間：${cleanText(item.date)} ${cleanText(item.time)}`.trim());
  if (item.location) lines.push(`  地點：${cleanText(item.location)}`);
  if (item.localMapHref) lines.push(`  地圖：${item.localMapHref}`);
  if (item.note) lines.push(`  補充：${cleanText(item.note)}`);
  if (item.officialLinkHref || item.linkUrlHref) lines.push(`  連結：${item.officialLinkHref || item.linkUrlHref}`);
  return lines.join('\n');
}

function parseFlightInfo(flyText) {
  const text = cleanText(flyText);
  const info = {
    raw: text,
    dates: Array.from(new Set((text.match(/20\d{2}\/\d{1,2}\/\d{1,2}/g) || []).map(normalizeDate))),
    airports: Array.from(new Set(text.match(/\b[A-Z]{3}\b/g) || [])),
    hasTaiwan: /台灣|桃園|TPE|台北桃園/i.test(text),
    hasSanJose: /聖荷西|San Jose|SJC/i.test(text),
    hasReturn: /返程|回程|返台/i.test(text),
    hasDeparture: /出發|去程|搭機/i.test(text),
  };
  return info;
}

function answerPeopleList(peopleData) {
  const names = peopleData.map((p) => cleanText(p.name)).filter(Boolean);
  if (!names.length) return '';
  return `【人員名單】\n${names.join('、')}`;
}

function answerPrep(prepData) {
  if (!prepData.length) return '';
  const lines = ['【禮品準備 / 行前準備】'];
  prepData.slice(0, 20).forEach((row) => {
    const parts = Object.entries(row)
      .filter(([, value]) => cleanText(value))
      .map(([key, value]) => `${key}：${cleanText(value)}`);
    if (parts.length) lines.push(`- ${parts.join('｜')}`);
  });
  return lines.join('\n');
}

function answerTripPlan(referenceData) {
  const found = referenceData.find((item) => /出訪團規劃/.test(cleanText(item.item)));
  if (!found) return '';
  const lines = ['【出訪團規劃】'];
  if (found.content) lines.push(found.content);
  if (found.linkHref) lines.push(`連結：${found.linkHref}`);
  return lines.join('\n');
}

function answerConferenceInfo(question, referenceData) {
  const q = normalizeQuestion(question);

  if (q.includes('GTC')) {
    return `【GTC 官方資訊】\n連結：https://www.nvidia.com/zh-tw/gtc/`;
  }

  if (q.includes('HIMSS')) {
    const found =
      referenceData.find((item) => /HIMSS conference/i.test(cleanText(item.item))) ||
      referenceData.find((item) => /HIMSS/.test(cleanText(item.item)));

    const lines = ['【HIMSS 官方資訊】'];
    if (found?.content) lines.push(found.content);
    if (found?.linkHref) {
      lines.push(`連結：${found.linkHref}`);
    } else {
      lines.push('連結：https://www.himssconference.com/');
    }
    return lines.join('\n');
  }

  return '';
}

function answerDaySchedule(question, tripData) {
  const q = normalizeQuestion(question);
  const dateToken = extractDateToken(q);
  if (!dateToken) return '';
  if (!q.includes('行程')) return '';

  const items = tripData
    .filter((item) => normalizeDate(item.date) === dateToken)
    .sort(sortByDateTime);

  if (!items.length) {
    return `${dateToken} 目前沒有行程資料。`;
  }

  const lines = [`【${dateToken} 行程】`];
  items.forEach((item) => lines.push(formatTripLine(item)));
  return lines.join('\n');
}

function answerReturnTaiwan(question, taskData) {
  const q = normalizeQuestion(question);
  const dateToken = extractDateToken(q);

  if (!(q.includes('返台') || q.includes('回台灣') || q.includes('誰回台灣') || q.includes('搭機返台'))) {
    return '';
  }

  const matched = taskData.filter((item) => {
    const info = parseFlightInfo(item.fly);
    const text = cleanText(item.fly);
    const dateOk = dateToken ? text.includes(dateToken) : true;
    return dateOk && (info.hasReturn || info.hasTaiwan);
  });

  if (!matched.length) {
    return dateToken ? `${dateToken} 目前沒有明確返台班機資料。` : '目前沒有明確返台班機資料。';
  }

  const names = matched.map((item) => item.name).filter(Boolean);
  const title = dateToken ? `【${dateToken} 返台人員】` : '【返台人員】';
  return `${title}\n${names.join('、')}`;
}

function answerArrivalSanJose(question, taskData, peopleData) {
  const q = normalizeQuestion(question);
  if (!(q.includes('聖荷西') || /San Jose|SJC/i.test(q))) return '';

  const allNames = peopleData.map((p) => p.name).filter(Boolean);
  const member = findBestMemberInQuestion(q, allNames);
  if (!member) return '';

  const found = taskData.find((item) => cleanText(item.name) === member || cleanText(item.name).includes(member));
  if (!found) return `${member} 目前沒有班機資料。`;

  const flyText = cleanText(found.fly);
  const lines = [`【${member} 抵達聖荷西資訊】`];

  if (/聖荷西|San Jose|SJC/i.test(flyText)) {
    lines.push(`- 人員：${member}`);
    lines.push(`- 班機資訊：${flyText}`);
    return lines.join('\n');
  }

  return `【${member} 抵達聖荷西資訊】\n目前資料中未找到明確的聖荷西抵達描述。\n- 班機資訊：${flyText || '未提供'}`;
}

function answerMemberSchedule(question, tripData, peopleData) {
  const q = normalizeQuestion(question);
  const allNames = peopleData.map((p) => p.name).filter(Boolean);
  const member = findBestMemberInQuestion(q, allNames);
  if (!member) return '';
  if (!q.includes('行程')) return '';

  const items = tripData.filter((item) => includesMember(item.members, member)).sort(sortByDateTime);
  if (!items.length) return `${member} 目前沒有行程資料。`;

  const lines = [`【${member} 的行程】`];
  items.forEach((item) => {
    lines.push(`- ${item.date} ${item.time || '時間未填'}｜${item.activity || '未命名行程'}${item.location ? `｜${item.location}` : ''}`);
  });
  return lines.join('\n');
}

function answerMealLocation(question, tripData, peopleData) {
  const q = normalizeQuestion(question);
  const dateToken = extractDateToken(q);
  const allNames = peopleData.map((p) => p.name).filter(Boolean);
  const member = findBestMemberInQuestion(q, allNames);
  const asksMeal = q.includes('晚餐') || q.includes('午餐') || q.includes('餐會') || q.includes('餐廳');
  const asksLocation = q.includes('哪裡') || q.includes('在哪') || q.includes('地址') || q.includes('地點');

  if (!asksMeal || !asksLocation) return '';

  let candidates = tripData.filter((item) => {
    const hay = flattenSearchableText(item);
    return /餐|晚宴|午宴|Reception/i.test(hay);
  });

  if (dateToken) {
    candidates = candidates.filter((item) => normalizeDate(item.date) === dateToken);
  }

  if (member) {
    const memberFiltered = candidates.filter((item) => includesMember(item.members, member));
    if (memberFiltered.length) candidates = memberFiltered;
  }

  if (!candidates.length) return '';

  const best = candidates.sort(sortByDateTime)[0];
  const title =
    member && dateToken
      ? `【${member} ${dateToken} 用餐地點】`
      : dateToken
      ? `【${dateToken} 用餐地點】`
      : '【用餐地點】';

  const lines = [title];
  lines.push(`- 活動：${best.activity || '未命名餐會'}`);
  if (best.date || best.time) lines.push(`- 日期時間：${cleanText(best.date)} ${cleanText(best.time)}`.trim());
  if (best.location) lines.push(`- 地點：${best.location}`);
  if (best.localMapHref) lines.push(`地圖：${best.localMapHref}`);
  if (best.note) lines.push(`- 補充：${best.note}`);
  return lines.join('\n');
}

function answerLocationQuestion(question, tripData, referenceData) {
  const q = normalizeQuestion(question);
  const asksLocation = q.includes('哪裡') || q.includes('在哪') || q.includes('地址') || q.includes('地點') || q.includes('地圖');
  if (!asksLocation) return '';

  const dateToken = extractDateToken(q);

  let tripCandidates = tripData.filter((item) => {
    const hay = flattenSearchableText(item);
    const dateOk = dateToken ? normalizeDate(item.date) === dateToken : true;
    return dateOk && Object.values(item).some((v) => cleanText(v)) && [...q].some((ch) => hay.includes(ch));
  });

  if (q.includes('HIMSS會場') || q.includes('HIMSS 會場') || q.includes('會場在哪')) {
    tripCandidates = tripData.filter((item) => {
      const hay = flattenSearchableText(item);
      return /HIMSS|會場|conference/i.test(hay);
    });
  }

  if (tripCandidates.length) {
    const best = tripCandidates.sort(sortByDateTime)[0];
    return `【地點資訊】\n${formatLocationBlock(best)}`;
  }

  const refCandidates = referenceData.filter((item) => {
    const hay = flattenSearchableText(item);
    return [...q].some((ch) => hay.includes(ch));
  });

  if (refCandidates.length) {
    const best = refCandidates[0];
    const lines = ['【參考資料】'];
    if (best.item) lines.push(`- 項目：${best.item}`);
    if (best.content) lines.push(`- 內容：${best.content}`);
    if (best.linkHref) lines.push(`連結：${best.linkHref}`);
    return lines.join('\n');
  }

  return '';
}

function deterministicAnswer(question, context) {
  const tripData = (Array.isArray(context?.tripData) ? context.tripData : []).map(mapTripItem);
  const taskData = (Array.isArray(context?.taskData) ? context.taskData : []).map(mapTaskItem);
  const referenceData = (Array.isArray(context?.referenceData) ? context.referenceData : []).map(mapReferenceItem);
  const peopleData = (Array.isArray(context?.peopleData) ? context.peopleData : []).map(mapPeopleItem);
  const prepData = Array.isArray(context?.prepData) ? context.prepData : [];

  const q = normalizeQuestion(question);

  const strategies = [
    () => (q.includes('人員名單') ? answerPeopleList(peopleData) : ''),
    () => (q.includes('禮品') || q.includes('準備') || q.includes('行前') ? answerPrep(prepData) : ''),
    () => (q.includes('出訪團規劃') ? answerTripPlan(referenceData) : ''),
    () => answerConferenceInfo(q, referenceData),
    () => answerDaySchedule(q, tripData),
    () => answerReturnTaiwan(q, taskData),
    () => answerArrivalSanJose(q, taskData, peopleData),
    () => answerMealLocation(q, tripData, peopleData),
    () => answerMemberSchedule(q, tripData, peopleData),
    () => answerLocationQuestion(q, tripData, referenceData),
  ];

  for (const fn of strategies) {
    const result = fn();
    if (cleanText(result)) return result;
  }

  return '';
}

function scoreTripItem(item, question, dateToken, member) {
  let score = 0;
  const q = normalizeQuestion(question);
  const haystack = flattenSearchableText(item);

  if (dateToken && normalizeDate(item.date) === dateToken) score += 12;
  if (member && includesMember(item.members, member)) score += 10;

  if (q.includes('地址') || q.includes('地點') || q.includes('哪裡') || q.includes('在哪') || q.includes('地圖')) {
    if (cleanText(item.location)) score += 8;
    if (cleanText(item.localMap) || cleanText(item.localMapHref)) score += 8;
  }

  if (q.includes('會場') && /HIMSS|GTC|會場|conference/i.test(haystack)) score += 10;
  if ((q.includes('晚餐') || q.includes('午餐') || q.includes('餐會')) && /餐|晚宴|午宴|Reception/i.test(haystack)) score += 8;
  if (q.includes('行程')) score += 4;

  const keywords = ['HIMSS', 'GTC', '餐', '晚餐', '午餐', '參訪', '住宿', '會議', '返台', '出發', '聖荷西', '晚宴', '接駁'];
  keywords.forEach((kw) => {
    if (q.includes(kw) && haystack.includes(kw)) score += 3;
  });

  return score;
}

function scoreTaskItem(item, question, dateToken, member) {
  let score = 0;
  const q = normalizeQuestion(question);
  const haystack = flattenSearchableText(item);

  if (dateToken && haystack.includes(dateToken)) score += 12;
  if (member && cleanText(item.name) === member) score += 10;

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

  ['HIMSS', 'GTC', '手冊', '會場', '地址', '官方', '文件', '注意事項', '地圖', '出訪團規劃'].forEach((kw) => {
    if (q.includes(kw) && haystack.includes(kw)) score += 4;
  });

  return score;
}

function pickRelevantContext(question, context) {
  const q = normalizeQuestion(question);
  const dateToken = extractDateToken(q);

  const tripData = (Array.isArray(context?.tripData) ? context.tripData : []).map(mapTripItem);
  const taskData = (Array.isArray(context?.taskData) ? context.taskData : []).map(mapTaskItem);
  const referenceData = (Array.isArray(context?.referenceData) ? context.referenceData : []).map(mapReferenceItem);
  const peopleData = (Array.isArray(context?.peopleData) ? context.peopleData : []).map(mapPeopleItem);
  const prepData = Array.isArray(context?.prepData) ? context.prepData : [];

  const allNames = peopleData.map((p) => p.name).filter(Boolean);
  const member = findBestMemberInQuestion(q, allNames);

  const relevantTrips = tripData
    .map((item) => ({ ...item, __score: scoreTripItem(item, q, dateToken, member) }))
    .filter((item) => item.__score > 0)
    .sort((a, b) => b.__score - a.__score)
    .slice(0, 20)
    .map(({ __score, ...rest }) => rest);

  const relevantTasks = taskData
    .map((item) => ({ ...item, __score: scoreTaskItem(item, q, dateToken, member) }))
    .filter((item) => item.__score > 0)
    .sort((a, b) => b.__score - a.__score)
    .slice(0, 12)
    .map(({ __score, ...rest }) => rest);

  const relevantRefs = referenceData
    .map((item) => ({ ...item, __score: scoreReferenceItem(item, q) }))
    .filter((item) => item.__score > 0)
    .sort((a, b) => b.__score - a.__score)
    .slice(0, 10)
    .map(({ __score, ...rest }) => rest);

  const mentionedPeople = member
    ? peopleData.filter((p) => cleanText(p.name) === member || q.includes(cleanText(p.name))).slice(0, 10)
    : peopleData.filter((p) => q.includes(cleanText(p.name))).slice(0, 10);

  const relevantPrep =
    q.includes('禮品') || q.includes('準備') || q.includes('行前')
      ? prepData.slice(0, 20)
      : [];

  return {
    dateToken,
    member,
    relevantTrips,
    relevantTasks,
    relevantRefs,
    mentionedPeople,
    relevantPrep,
    summary: {
      tripCount: tripData.length,
      taskCount: taskData.length,
      refCount: referenceData.length,
      peopleCount: peopleData.length,
      prepCount: prepData.length,
    },
  };
}

function buildStructuredHint(question, picked) {
  const q = normalizeQuestion(question);
  const lines = [];

  lines.push(`使用者問題：${q}`);
  if (picked.dateToken) lines.push(`問題中的日期：${picked.dateToken}`);
  if (picked.member) lines.push(`問題中的人員：${picked.member}`);

  if (picked.relevantTrips.length) {
    lines.push('\n【最相關的行程資料】');
    picked.relevantTrips.forEach((item, idx) => {
      lines.push(
        `${idx + 1}. 日期=${cleanText(item.date)}；時間=${cleanText(item.time)}；活動=${cleanText(item.activity)}；類型=${cleanText(item.activityType)}；分類=${cleanText(item.category)}；地點=${cleanText(item.location)}；地圖=${cleanText(item.localMapHref || item.localMap)}；成員=${cleanText(item.members)}；活動窗口=${cleanText(item.contact)}；交通=${cleanText(item.transitTime)}；備註=${cleanText(item.note)}；附件=${cleanText(item.attachmentUrl)}；官方連結=${cleanText(item.officialLinkHref || item.officialLink || item.linkUrlHref || item.linkUrl)}`
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
        `${idx + 1}. 項目=${cleanText(item.item)}；內容=${cleanText(item.content)}；連結=${cleanText(item.linkHref || item.link)}`
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
  lines.push(`tripData 筆數=${picked.summary.tripCount}`);
  lines.push(`taskData 筆數=${picked.summary.taskCount}`);
  lines.push(`referenceData 筆數=${picked.summary.refCount}`);
  lines.push(`peopleData 筆數=${picked.summary.peopleCount}`);
  lines.push(`prepData 筆數=${picked.summary.prepCount}`);

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

    const directAnswer = deterministicAnswer(question, context || {});
    if (cleanText(directAnswer)) {
      return res.status(200).json({ answer: directAnswer });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY 未設定' });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const picked = pickRelevantContext(question, context || {});
    const structuredHint = buildStructuredHint(question, picked);

    const systemPrompt = `
你是「秀傳醫療體系 2026 HIMSS+GTC 參訪團」網站中的 AI 助手。
名稱固定為「秀傳AI小秘書」。

你的角色是：
根據內部行程資料、班機資料、參考資料，提供精準、可執行、可直接使用的行程助理回答。

你只能依據提供資料回答，不能自行用外部常識補資料。
如果資料沒有，就回答：
- 資料不足
- 目前資料未提供
- 目前資料中沒有找到明確資訊

====================
【最高優先規則】
====================

1. 若資料中已有 location、localMap、link、content、note、officialLink、attachmentUrl，
   必須優先使用，不可忽略。
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
   - 出發 / 抵達 / 返台時間
   - 補充說明（若有）

12. 若是某日行程問題，回答格式優先如下：
   - 先寫日期
   - 然後逐條列出：時間｜活動名稱｜地點
   - 若有地圖連結，可補充

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

====================
【禁止事項】
====================

22. 禁止自行用一般網路常識補充會場地址。
23. 禁止忽略內部資料已經存在的地點與地圖欄位。
24. 禁止捏造資訊。
25. 禁止只回答模糊描述，若資料中有明確地點就要寫出來。

====================
【回答品質要求】
====================

26. 回答要像專業旅程助理，不像閒聊機器人。
27. 條列要清楚，避免一大段文字。
28. 若資料中同時有 location 與 map，請兩者都保留。
29. 若資料已足夠，直接給結論，不要叫使用者再去查。
`;

    const userPrompt = `
以下是根據問題預先篩選出的最相關資料，你必須優先根據這些資料回答。

${structuredHint}
`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.05,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
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