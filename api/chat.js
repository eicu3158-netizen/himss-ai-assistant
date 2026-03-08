import OpenAI from 'openai';

function cleanText(value) {
  return String(value ?? '').replace(/^\ufeff/, '').trim();
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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

function normalizeDate(rawDate) {
  const cleaned = cleanText(rawDate).replace(/[.-]/g, '/');
  if (!cleaned) return '';
  const match = cleaned.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return cleaned;
  return `${match[1]}/${match[2].padStart(2, '0')}/${match[3].padStart(2, '0')}`;
}

function toDateString(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

function shiftDate(baseDateText, offsetDays) {
  const base = cleanText(baseDateText);
  if (!base) return '';
  const normalized = base.replace(/-/g, '/');
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return '';

  const dt = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );

  if (Number.isNaN(dt.getTime())) return '';

  dt.setDate(dt.getDate() + offsetDays);
  return toDateString(dt);
}

function extractDateToken(question, currentDate = '') {
  const q = normalizeQuestion(question);

  if (q.includes('今天')) return shiftDate(currentDate, 0);
  if (q.includes('明天')) return shiftDate(currentDate, 1);
  if (q.includes('後天')) return shiftDate(currentDate, 2);
  if (q.includes('大後天')) return shiftDate(currentDate, 3);
  if (q.includes('昨天')) return shiftDate(currentDate, -1);

  let match = q.match(/(20\d{2})\/(\d{1,2})\/(\d{1,2})/);
  if (match) {
    return `${match[1]}/${match[2].padStart(2, '0')}/${match[3].padStart(2, '0')}`;
  }

  match = q.match(/(^|[^0-9])(\d{1,2})\/(\d{1,2})(?!\d)/);
  if (match) {
    return `2026/${match[2].padStart(2, '0')}/${match[3].padStart(2, '0')}`;
  }

  return '';
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
  const link = normalizeLink(value);
  return /google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google/i.test(link);
}

function removeUrlsFromText(value) {
  return cleanText(value)
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/www\.[^\s]+/gi, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function extractAddressText(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  return removeUrlsFromText(raw);
}

function buildGoogleMapSearchUrl(keyword) {
  const text = cleanText(keyword);
  if (!text) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
}

function extractReadablePlaceFromMapUrl(url) {
  const href = normalizeLink(url);
  if (!href) return '';

  try {
    const parsed = new URL(href);

    const q =
      parsed.searchParams.get('q') ||
      parsed.searchParams.get('query') ||
      parsed.searchParams.get('destination') ||
      parsed.searchParams.get('daddr') ||
      parsed.searchParams.get('saddr');

    if (q) return safeDecode(q).replace(/\+/g, ' ').trim();

    const placeMatch = parsed.pathname.match(/\/place\/([^/]+)/i);
    if (placeMatch?.[1]) {
      return safeDecode(placeMatch[1]).replace(/\+/g, ' ').trim();
    }

    return '';
  } catch {
    return '';
  }
}

function buildDisplayLocation(rawLocation, mapHref) {
  const locationText = cleanText(rawLocation);
  const addressOnlyText = extractAddressText(rawLocation);

  if (addressOnlyText) {
    return addressOnlyText;
  }

  const parsedFromMap = extractReadablePlaceFromMapUrl(mapHref);
  if (parsedFromMap) return parsedFromMap;

  if (mapHref || looksLikeGoogleMap(locationText)) {
    return '地址文字未填，已提供地圖連結';
  }

  return '';
}

function mapTripItem(row) {
  const rawLocation = getValue(row, ['location', 'locationDisplay']);
  const officialLink = getValue(row, ['officialLink', 'officialLinkHref']);
  const linkUrl = getValue(row, ['linkUrl', 'linkUrlHref']);
  const localMap = getValue(row, ['localMap', 'localmap', 'mapLink', 'localMapHref']);

  const locationHref = normalizeLink(rawLocation);
  const officialHref = normalizeLink(officialLink);
  const linkHref = normalizeLink(linkUrl);
  const localMapHref = normalizeLink(localMap);

  const locationHasMap = looksLikeGoogleMap(rawLocation);
  const officialIsMap = officialHref && looksLikeGoogleMap(officialLink);
  const linkIsMap = linkHref && looksLikeGoogleMap(linkUrl);

  const addressText = extractAddressText(rawLocation);

  const finalMapHref =
    localMapHref ||
    (locationHasMap ? locationHref : '') ||
    (officialIsMap ? officialHref : '') ||
    (linkIsMap ? linkHref : '') ||
    (addressText ? buildGoogleMapSearchUrl(addressText) : '');

  const locationDisplay =
    getValue(row, ['locationDisplay']) || buildDisplayLocation(rawLocation, finalMapHref);

  return {
    category: getValue(row, ['category']),
    activityType: getValue(row, ['activityType']),
    date: normalizeDate(getValue(row, ['date'])),
    time: getValue(row, ['time']),
    activity: getValue(row, ['activity']),
    location: addressText,
    locationDisplay,
    members: getValue(row, ['members']),
    contact: getValue(row, ['contact']),
    transitTime: getValue(row, ['transitTime']),
    note: getValue(row, ['note']),
    officialLink,
    officialLinkHref: !officialIsMap ? officialHref : '',
    linkUrl,
    linkUrlHref: !linkIsMap ? linkHref : '',
    localMap,
    localMapHref: finalMapHref,
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
    linkHref: normalizeLink(getValue(row, ['link', '連結', 'linkHref'])),
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
  const location = cleanText(item.locationDisplay || item.location);
  return `- ${time}｜${activity}${location ? `｜${location}` : ''}`;
}

function formatLocationBlock(item) {
  const lines = [];
  lines.push(`- 項目：${cleanText(item.activity) || '未命名活動'}`);
  if (item.date || item.time) {
    lines.push(`- 日期時間：${cleanText(item.date)} ${cleanText(item.time)}`.trim());
  }

  const locationText = cleanText(item.locationDisplay || item.location);
  if (locationText) {
    lines.push(`- 地點：${locationText}`);
  }

  if (item.localMapHref) {
    lines.push(`地圖：${item.localMapHref}`);
  }

  if (item.note) {
    lines.push(`- 補充：${cleanText(item.note)}`);
  }

  const webLink = cleanText(item.officialLinkHref || item.linkUrlHref);
  if (webLink) {
    lines.push(`連結：${webLink}`);
  }

  return lines.join('\n');
}

function parseFlightInfo(flyText) {
  const text = cleanText(flyText);
  return {
    raw: text,
    dates: Array.from(new Set((text.match(/20\d{2}\/\d{1,2}\/\d{1,2}/g) || []).map(normalizeDate))),
    airports: Array.from(new Set(text.match(/\b[A-Z]{3}\b/g) || [])),
    hasTaiwan: /台灣|桃園|TPE|台北桃園/i.test(text),
    hasSanJose: /聖荷西|San Jose|SJC/i.test(text),
    hasReturn: /返程|回程|返台/i.test(text),
    hasDeparture: /出發|去程|搭機/i.test(text),
  };
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
      referenceData.find((item) => /HIMSS/i.test(cleanText(item.item)));

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

function answerDaySchedule(question, tripData, currentDate) {
  const q = normalizeQuestion(question);
  const dateToken = extractDateToken(q, currentDate);
  if (!dateToken || !q.includes('行程')) return '';

  const items = tripData
    .filter((item) => normalizeDate(item.date) === dateToken)
    .sort(sortByDateTime);

  if (!items.length) return `${dateToken} 目前沒有行程資料。`;

  const lines = [`【${dateToken} 行程】`];
  items.forEach((item) => lines.push(formatTripLine(item)));
  return lines.join('\n');
}

function answerReturnTaiwan(question, taskData, currentDate) {
  const q = normalizeQuestion(question);
  const dateToken = extractDateToken(q, currentDate);

  if (!(q.includes('返台') || q.includes('誰回台灣') || q.includes('搭機返台') || q.includes('返程班機'))) {
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
  return `${dateToken ? `【${dateToken} 返台人員】` : '【返台人員】'}\n${names.join('、')}`;
}

function answerArrivalSanJose(question, taskData, peopleData) {
  const q = normalizeQuestion(question);
  if (!(q.includes('聖荷西') || /San Jose|SJC/i.test(q))) return '';

  const allNames = peopleData.map((p) => p.name).filter(Boolean);
  const member = findBestMemberInQuestion(q, allNames);
  if (!member) return '';

  const found = taskData.find((item) => cleanText(item.name) === member || cleanText(item.name).includes(member));
  if (!found) return `${member} 目前沒有班機資料。`;

  return `【${member} 抵達聖荷西資訊】\n- 人員：${member}\n- 班機資訊：${cleanText(found.fly) || '未提供'}`;
}

function answerMemberSchedule(question, tripData, peopleData) {
  const q = normalizeQuestion(question);
  const allNames = peopleData.map((p) => p.name).filter(Boolean);
  const member = findBestMemberInQuestion(q, allNames);
  if (!member || !q.includes('行程')) return '';

  const items = tripData.filter((item) => includesMember(item.members, member)).sort(sortByDateTime);
  if (!items.length) return `${member} 目前沒有行程資料。`;

  const lines = [`【${member} 的行程】`];
  items.forEach((item) => {
    lines.push(
      `- ${item.date} ${item.time || '時間未填'}｜${item.activity || '未命名行程'}${
        cleanText(item.locationDisplay || item.location) ? `｜${cleanText(item.locationDisplay || item.location)}` : ''
      }`
    );
  });
  return lines.join('\n');
}

function answerMealLocation(question, tripData, peopleData, currentDate) {
  const q = normalizeQuestion(question);
  const dateToken = extractDateToken(q, currentDate);
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
  const locationText = cleanText(best.locationDisplay || best.location);

  const lines = [
    member && dateToken
      ? `【${member} ${dateToken} 用餐地點】`
      : dateToken
      ? `【${dateToken} 用餐地點】`
      : '【用餐地點】',
    `- 活動：${best.activity || '未命名餐會'}`,
  ];

  if (best.date || best.time) lines.push(`- 日期時間：${cleanText(best.date)} ${cleanText(best.time)}`.trim());
  if (locationText) lines.push(`- 地點：${locationText}`);
  if (best.localMapHref) lines.push(`地圖：${best.localMapHref}`);
  if (best.note) lines.push(`- 補充：${best.note}`);

  return lines.join('\n');
}

function answerLocationQuestion(question, tripData, referenceData, currentDate) {
  const q = normalizeQuestion(question);
  const asksLocation = q.includes('哪裡') || q.includes('在哪') || q.includes('地址') || q.includes('地點') || q.includes('地圖');
  if (!asksLocation) return '';

  const dateToken = extractDateToken(q, currentDate);

  let tripCandidates = tripData.filter((item) => {
    const hay = flattenSearchableText(item);
    const dateOk = dateToken ? normalizeDate(item.date) === dateToken : true;
    return dateOk && [...q].some((ch) => hay.includes(ch));
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

function deterministicAnswer(question, context, currentDate) {
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
    () => answerDaySchedule(q, tripData, currentDate),
    () => answerReturnTaiwan(q, taskData, currentDate),
    () => answerArrivalSanJose(q, taskData, peopleData),
    () => answerMealLocation(q, tripData, peopleData, currentDate),
    () => answerMemberSchedule(q, tripData, peopleData),
    () => answerLocationQuestion(q, tripData, referenceData, currentDate),
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
    if (cleanText(item.locationDisplay || item.location)) score += 8;
    if (cleanText(item.localMapHref || item.localMap)) score += 8;
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

  ['返台', '回程', '返程', '出發', '搭機', '班機', '抵達', '聖荷西', '台灣', '桃園', 'TPE', 'SJC', 'San Jose'].forEach((kw) => {
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

function pickRelevantContext(question, context, currentDate) {
  const q = normalizeQuestion(question);
  const dateToken = extractDateToken(q, currentDate);

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
        `${idx + 1}. 日期=${cleanText(item.date)}；時間=${cleanText(item.time)}；活動=${cleanText(item.activity)}；類型=${cleanText(item.activityType)}；分類=${cleanText(item.category)}；地點=${cleanText(item.locationDisplay || item.location)}；地圖=${cleanText(item.localMapHref || item.localMap)}；成員=${cleanText(item.members)}；活動窗口=${cleanText(item.contact)}；交通=${cleanText(item.transitTime)}；備註=${cleanText(item.note)}；附件=${cleanText(item.attachmentUrl)}；官方連結=${cleanText(item.officialLinkHref || item.officialLink || item.linkUrlHref || item.linkUrl)}`
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

    const { question, context, currentDate } = req.body || {};

    if (!question) {
      return res.status(400).json({ error: 'Missing question' });
    }

    const directAnswer = deterministicAnswer(question, context || {}, currentDate || '');
    if (cleanText(directAnswer)) {
      return res.status(200).json({ answer: directAnswer });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY 未設定' });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const picked = pickRelevantContext(question, context || {}, currentDate || '');
    const structuredHint = buildStructuredHint(question, picked);

    const systemPrompt = `
你是「秀傳醫療體系 2026 HIMSS+GTC 參訪團」網站中的 AI 助手。
名稱固定為「秀傳AI小秘書」。

你只能依據提供資料回答，不能自行用外部常識補資料。
若資料中只有地圖連結但沒有地址文字，必須明確寫：
「地址文字未填，已提供地圖連結」
不能寫「待確認」。

回答規則：
1. 一律繁體中文
2. 先直接回答重點
3. 適合手機閱讀
4. 不要輸出 markdown 連結格式，請直接寫：
   連結：https://...
   地圖：https://...
5. 若是行程，請依時間順序列出
6. 若是地址、地點、地圖問題，優先保留：
   - 項目
   - 日期時間
   - 地點
   - 地圖
   - 補充
7. 若資料足夠，不要回答資料不足
8. 禁止捏造地址
9. 若使用者問今天、明天、後天、大後天、昨天，請依 currentDate 推算
`;

    const userPrompt = `
以下是根據問題預先篩選出的最相關資料，你必須優先根據這些資料回答。

currentDate=${cleanText(currentDate)}

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