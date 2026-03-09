import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Paperclip,
  ExternalLink,
  CalendarDays,
  MapPin,
  Clock,
  Users,
  Car,
  Send,
  Bot,
  Sparkles,
  AlertCircle,
  UtensilsCrossed,
  User,
  BookOpen,
  FileText,
  Cpu,
  ClipboardList,
  Gift,
  Plane,
  ChevronRight,
  ShieldCheck,
  Building2,
  Globe,
  MessageCircle,
  Phone,
} from 'lucide-react';

// ===== Google Sheet CSV 匯出網址 =====
const TRIP_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1-hXGxiOVY8fnVYKX-45Uty5cKYUhSQvo9gnsuW1D47Q/export?format=csv&gid=1007063747';
const PEOPLE_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1-hXGxiOVY8fnVYKX-45Uty5cKYUhSQvo9gnsuW1D47Q/export?format=csv&gid=2047962001';
const TASK_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1-hXGxiOVY8fnVYKX-45Uty5cKYUhSQvo9gnsuW1D47Q/export?format=csv&gid=1378242916';
const PREP_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1-hXGxiOVY8fnVYKX-45Uty5cKYUhSQvo9gnsuW1D47Q/export?format=csv&gid=1478862405';
const REFERENCE_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1-hXGxiOVY8fnVYKX-45Uty5cKYUhSQvo9gnsuW1D47Q/export?format=csv&gid=581197226';
const DATE_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1-hXGxiOVY8fnVYKX-45Uty5cKYUhSQvo9gnsuW1D47Q/export?format=csv&gid=1003250941';
const ART_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1-hXGxiOVY8fnVYKX-45Uty5cKYUhSQvo9gnsuW1D47Q/export?format=csv&gid=84464990';

// ===== 官方網站 =====
const HIMSS_CONFERENCE_URL = 'https://www.himssconference.com/';
const GTC_CONFERENCE_URL = 'https://www.nvidia.com/zh-tw/gtc/';

// ===== 主分頁 =====
const mainTabs = [
  { key: 'daily', label: '每日行程' },
  { key: 'flight', label: '國際航空' },
  { key: 'meal', label: '餐會' },
  { key: 'visit', label: '參訪' },
  { key: 'stay', label: '住宿' },
  { key: 'meetingRelated', label: '會議相關' },
  { key: 'conference', label: 'Conference資訊' },
  { key: 'taskPrep', label: '任務與準備' },
  { key: 'notice', label: '重要資訊與注意事項' },
  { key: 'ai', label: 'AI 助手' },
];

// ===== 工具函式 =====
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

function parseCSV(csvText) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i += 1;
      row.push(cell);
      if (row.some((item) => cleanText(item) !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((item) => cleanText(item) !== '')) rows.push(row);
  }

  return rows;
}

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map((h) => cleanText(h));

  return rows
    .slice(1)
    .map((row) => {
      const obj = {};
      headers.forEach((header, idx) => {
        obj[header] = cleanText(row[idx] ?? '');
      });
      return obj;
    })
    .filter((obj) => Object.values(obj).some((v) => cleanText(v) !== ''));
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
  const cleaned = cleanText(rawDate);
  if (!cleaned) return '';
  const normalized = cleaned.replace(/[.-]/g, '/');
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return cleaned;
  const year = match[1];
  const month = match[2].padStart(2, '0');
  const day = match[3].padStart(2, '0');
  return `${year}/${month}/${day}`;
}

function normalizeQuestionTypos(text) {
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

function splitMembers(membersText) {
  if (!membersText) return [];
  return String(membersText)
    .split(/[\n、,，/;；]+/)
    .map((name) => cleanText(name))
    .filter(Boolean);
}

function includesMember(membersText, selectedMember) {
  if (!selectedMember || selectedMember === '全部') return true;
  return splitMembers(membersText).some(
    (name) => name === selectedMember || name.includes(selectedMember) || selectedMember.includes(name)
  );
}

function sortByDateTime(a, b) {
  const aKey = `${a.date || ''} ${a.time || ''}`;
  const bKey = `${b.date || ''} ${b.time || ''}`;
  return aKey.localeCompare(bKey, 'zh-Hant');
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

function looksLikeGoogleMap(url) {
  const link = normalizeLink(url);
  return /google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google/i.test(link);
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

function buildDisplayLocation(addressText, mapHref) {
  const address = cleanText(addressText);

  if (address) return address;

  const parsedFromMap = extractReadablePlaceFromMapUrl(mapHref);
  if (parsedFromMap) return parsedFromMap;

  if (mapHref) return '地址文字未填，已提供地圖連結';

  return '';
}

function buildEmbedMapUrl(item) {
  const mapHref = normalizeLink(item.localMapHref || item.localMap || item.location);
  const locationText = cleanText(item.locationDisplay || item.address);

  if (locationText && locationText !== '地址文字未填，已提供地圖連結') {
    return `https://www.google.com/maps?q=${encodeURIComponent(locationText)}&output=embed`;
  }

  if (mapHref) {
    return `https://www.google.com/maps?q=${encodeURIComponent(mapHref)}&output=embed`;
  }

  return '';
}

function extractDateTokenFromQuestion(question) {
  const q = normalizeQuestionTypos(question);

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

function findBestMemberInQuestion(question, members) {
  const q = normalizeQuestionTypos(question);
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

function buildHimssDailyLinks(referenceData) {
  const map = {
    '3/9': '',
    '3/10': '',
    '3/11': '',
    '3/12': '',
  };

  referenceData.forEach((item) => {
    const title = cleanText(item.item);
    const safeLink = normalizeLink(item.linkHref || item.link);
    if (!safeLink) return;

    if (/0309|03\/09|3\/9/i.test(title)) map['3/9'] = safeLink;
    if (/0310|03\/10|3\/10/i.test(title)) map['3/10'] = safeLink;
    if (/0311|03\/11|3\/11/i.test(title)) map['3/11'] = safeLink;
    if (/0312|03\/12|3\/12/i.test(title)) map['3/12'] = safeLink;
  });

  return map;
}

function getCardSurface(item) {
  const type = cleanText(item.activityType);
  const category = cleanText(item.category);

  if (type.includes('餐會') || type.includes('餐敘') || category.includes('餐')) {
    return 'bg-amber-50/80 border-amber-100';
  }
  if (type.includes('參訪') || category.includes('參訪')) {
    return 'bg-violet-50/80 border-violet-100';
  }
  if (type.includes('住宿') || category.includes('住宿')) {
    return 'bg-emerald-50/80 border-emerald-100';
  }
  if (type.includes('會議') || category.includes('會議')) {
    return 'bg-sky-50/80 border-sky-100';
  }
  if (category.includes('會議相關')) {
    return 'bg-blue-50/80 border-blue-100';
  }
  if (type.includes('班機') || category.includes('班機')) {
    return 'bg-slate-50 border-slate-200';
  }
  return 'bg-white border-slate-200';
}

function getTypeBadge(item) {
  const type = cleanText(item.activityType);
  const category = cleanText(item.category);

  if (type.includes('餐會') || type.includes('餐敘') || category.includes('餐')) {
    return { label: '餐會', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  }
  if (type.includes('參訪') || category.includes('參訪')) {
    return { label: '參訪', cls: 'bg-violet-50 text-violet-700 border-violet-200' };
  }
  if (type.includes('住宿') || category.includes('住宿')) {
    return { label: '住宿', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }
  if (type.includes('會議') || category.includes('會議')) {
    return { label: '會議', cls: 'bg-sky-50 text-sky-700 border-sky-200' };
  }
  if (category.includes('會議相關')) {
    return { label: '會議相關', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
  }
  if (type.includes('班機') || category.includes('班機')) {
    return { label: '飛行資訊', cls: 'bg-slate-100 text-slate-700 border-slate-200' };
  }
  return {
    label: category || type || '行程',
    cls: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  };
}

function matchType(item, target) {
  const t = cleanText(item.activityType);
  const c = cleanText(item.category);
  const activity = cleanText(item.activity);

  if (target === '餐會') {
    return (
      t.includes('餐會') ||
      t.includes('餐敘') ||
      c.includes('餐') ||
      activity.includes('餐') ||
      activity.includes('Reception') ||
      activity.includes('聚餐') ||
      activity.includes('晚宴')
    );
  }
  if (target === '參訪') {
    return t.includes('參訪') || c.includes('參訪') || activity.includes('參訪');
  }
  if (target === '住宿') {
    return (
      t.includes('住宿') ||
      c.includes('住宿') ||
      activity.includes('住宿') ||
      /hotel|inn|harrah/i.test(activity)
    );
  }
  if (target === '會議') {
    return t.includes('會議') || c.includes('會議');
  }
  if (target === '會議相關') {
    return c.includes('會議相關') || t.includes('會議相關');
  }
  return false;
}

// ===== 資料映射 =====
function mapTripRows(rawObjects) {
  return rawObjects
    .map((row) => {
      const address = getValue(row, ['address', '地址']);
      const mapLink = getValue(row, ['location', 'localmap', 'localMap', 'mapLink']);
      const officialLink = getValue(row, ['officialLink']);
      const linkUrl = getValue(row, ['linkUrl']);

      const mapHref = normalizeLink(mapLink);
      const officialHref = normalizeLink(officialLink);
      const linkHref = normalizeLink(linkUrl);

      const officialIsMap = officialHref && looksLikeGoogleMap(officialLink);
      const linkIsMap = linkHref && looksLikeGoogleMap(linkUrl);

      const finalMapHref =
        mapHref ||
        (officialIsMap ? officialHref : '') ||
        (linkIsMap ? linkHref : '') ||
        (address ? buildGoogleMapSearchUrl(address) : '');

      const locationDisplay = buildDisplayLocation(address, finalMapHref);

      return {
        category: getValue(row, ['category']),
        activityType: getValue(row, ['activityType']),
        date: normalizeDate(getValue(row, ['date'])),
        time: getValue(row, ['time']),
        activity: getValue(row, ['activity']),
        address,
        location: mapLink,
        locationDisplay,
        members: getValue(row, ['members']),
        contact: getValue(row, ['contact']),
        transitTime: getValue(row, ['transitTime']),
        note: getValue(row, ['note']),
        attachmentUrl: getValue(row, ['attachmentUrl']),
        localMap: mapLink,
        localMapHref: finalMapHref,
        linkUrl,
        linkUrlHref: !linkIsMap ? linkHref : '',
        officialLink,
        officialLinkHref: !officialIsMap ? officialHref : '',
        dataIssueLink:
          (!cleanText(officialLink) || normalizeLink(officialLink)) &&
          (!cleanText(linkUrl) || normalizeLink(linkUrl)) &&
          (!cleanText(getValue(row, ['attachmentUrl'])) || normalizeLink(getValue(row, ['attachmentUrl'])))
            ? ''
            : '資料問題：此筆連結不是有效網址',
      };
    })
    .filter(
      (item) =>
        item.category ||
        item.activityType ||
        item.date ||
        item.activity ||
        item.address ||
        item.location ||
        item.members
    );
}

function mapPeopleRows(rawObjects) {
  return rawObjects
    .map((row) => ({
      name: getValue(row, ['name']),
      englishName: getValue(row, ['englishName']),
      task: getValue(row, ['task', '任務']),
      phone: getValue(row, ['phone']),
      note: getValue(row, ['note']),
    }))
    .filter((item) => item.name);
}

function mapTaskRows(rawObjects) {
  return rawObjects
    .map((row) => ({
      name: getValue(row, ['name']),
      fly: getValue(row, ['fly']),
      diet: getValue(row, ['diet']),
      foodsAvoid: getValue(row, ['foods avoid', 'foodsAvoid']),
      phone: getValue(row, ['phone', '電話']),
    }))
    .filter((item) => item.name || item.fly || item.diet || item.foodsAvoid || item.phone);
}

function mapSimpleRows(rawObjects) {
  return rawObjects.map((row) => {
    const cleaned = {};
    Object.keys(row).forEach((key) => {
      cleaned[cleanText(key)] = cleanText(row[key]);
    });
    return cleaned;
  });
}

function mapDateRows(rawObjects) {
  return rawObjects
    .map((row) => normalizeDate(getValue(row, ['date'])))
    .filter(Boolean);
}

function mapReferenceRows(rawObjects) {
  return rawObjects
    .map((row) => {
      const item = getValue(row, ['項目', 'item']);
      const link = getValue(row, ['連結', 'link']);
      const content = getValue(row, ['內容', 'content', '摘要', 'note']);
      return {
        item,
        link,
        linkHref: normalizeLink(link),
        content,
        dataIssueLink: cleanText(link) && !normalizeLink(link) ? '資料問題：此筆連結不是有效網址' : '',
      };
    })
    .filter((item) => item.item || item.link || item.content);
}

function mapArtRows(rawObjects) {
  return rawObjects
    .map((row) => ({
      section: getValue(row, ['section', '區塊']),
      title: getValue(row, ['title', '標題']),
      imageUrl: getValue(row, ['imageUrl', '圖片']),
      linkUrl: getValue(row, ['linkUrl', '連結']),
      note: getValue(row, ['note', '備註']),
    }))
    .filter((item) => item.section || item.imageUrl || item.title);
}

// ===== 畫面元件 =====
function DetailRow({ icon, label, value }) {
  if (!value) return null;

  return (
    <div className="rounded-2xl border border-white/70 bg-white/80 p-3">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 text-slate-500">{icon}</div>
        <div className="min-w-0">
          <div className="text-xs font-bold text-slate-500">{label}</div>
          <div className="break-words whitespace-pre-wrap text-sm leading-6 text-slate-700">{value}</div>
        </div>
      </div>
    </div>
  );
}

function ResourceButtons({ item }) {
  const attachmentHref = normalizeLink(item.attachmentUrl);
  const mapHref = normalizeLink(item.localMapHref || item.localMap || item.location);

  let webHref =
    normalizeLink(item.officialLinkHref || item.officialLink) ||
    normalizeLink(item.linkUrlHref || item.linkUrl) ||
    '';

  if (looksLikeGoogleMap(webHref)) {
    webHref = '';
  }

  if (!attachmentHref && !mapHref && !webHref && !item.dataIssueLink) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {mapHref && (
        <a
          href={mapHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-800"
        >
          <MapPin size={16} />
          地圖
        </a>
      )}

      {webHref && (
        <a
          href={webHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-800"
        >
          <ExternalLink size={16} />
          網頁
        </a>
      )}

      {attachmentHref && (
        <a
          href={attachmentHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          <Paperclip size={16} />
          附件
        </a>
      )}

      {item.dataIssueLink && (
        <div className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
          <AlertCircle size={16} />
          {item.dataIssueLink}
        </div>
      )}
    </div>
  );
}

function MapPreview({ item }) {
  const mapHref = normalizeLink(item.localMapHref || item.localMap || item.location);
  const embedUrl = buildEmbedMapUrl(item);

  if (!mapHref || !embedUrl) return null;

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <MapPin size={16} className="text-emerald-700" />
          地圖預覽
        </div>
        <a
          href={mapHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:text-emerald-800"
        >
          開啟 Google Map
          <ChevronRight size={14} />
        </a>
      </div>
      <iframe
        title={`map-${item.activity || item.locationDisplay || item.address}`}
        src={embedUrl}
        className="h-64 w-full"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}

function InfoCard({ item }) {
  const badge = getTypeBadge(item);

  return (
    <article className={`rounded-3xl border p-4 shadow-sm md:p-6 ${getCardSurface(item)}`}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${badge.cls}`}>
          {badge.label}
        </span>

        {item.activityType && item.activityType !== badge.label && (
          <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {item.activityType}
          </span>
        )}

        {item.category && item.category !== badge.label && item.category !== item.activityType && (
          <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {item.category}
          </span>
        )}
      </div>

      <div className="mb-4 text-lg font-bold leading-7 text-slate-800">
        {item.activity || '未命名活動'}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <DetailRow icon={<CalendarDays size={16} />} label="日期" value={item.date} />
        <DetailRow icon={<Clock size={16} />} label="時間" value={item.time} />
        <DetailRow icon={<MapPin size={16} />} label="地點" value={item.locationDisplay || item.address} />
        <DetailRow icon={<Users size={16} />} label="成員" value={item.members} />
        <DetailRow icon={<User size={16} />} label="活動窗口" value={item.contact} />
        <DetailRow icon={<Car size={16} />} label="交通時間" value={item.transitTime} />
        <DetailRow icon={<AlertCircle size={16} />} label="備註" value={item.note} />
      </div>

      <ResourceButtons item={item} />
      <MapPreview item={item} />
    </article>
  );
}

function EmptyCard({ title = '目前尚無資料' }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500 shadow-sm">
      {title}
    </div>
  );
}

function SectionCard({ title, icon, children, subtitle }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
        </div>
        {subtitle ? <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

function SimpleKeyValueCard({ data }) {
  const entries = Object.entries(data).filter(([, value]) => cleanText(value));
  if (!entries.length) return null;

  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      {entries.map(([key, value]) => (
        <div key={key} className="mb-1 text-sm leading-7 text-slate-700">
          <span className="font-semibold text-slate-800">{key}：</span>
          {value}
        </div>
      ))}
    </div>
  );
}

function AIAnswerContent({ text }) {
  const lines = String(text || '').split('\n');

  return (
    <div className="space-y-2">
      {lines.map((line, idx) => {
        const content = cleanText(line);

        if (!content) return <div key={idx} className="h-1" />;

        if (/^【.*】$/.test(content)) {
          return (
            <div key={idx} className="pt-1 text-sm font-bold text-emerald-700">
              {content}
            </div>
          );
        }

        if (/^[-•]/.test(content)) {
          return (
            <div key={idx} className="pl-1 text-sm leading-7 text-slate-700">
              {content}
            </div>
          );
        }

        if (/^連結：https?:\/\//.test(content) || /^地圖：https?:\/\//.test(content)) {
          const parts = content.split('：');
          const label = parts[0];
          const href = content.replace(`${label}：`, '').trim();
          return (
            <div key={idx} className="text-sm leading-7">
              <span className="font-semibold text-slate-800">{label}：</span>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="break-all text-emerald-700 underline underline-offset-2"
              >
                {href}
              </a>
            </div>
          );
        }

        return (
          <div key={idx} className="text-sm leading-7 text-slate-700">
            {content}
          </div>
        );
      })}
    </div>
  );
}

// ===== 主程式 =====
export default function App() {
  const [tripData, setTripData] = useState([]);
  const [peopleData, setPeopleData] = useState([]);
  const [taskData, setTaskData] = useState([]);
  const [prepData, setPrepData] = useState([]);
  const [referenceData, setReferenceData] = useState([]);
  const [dateData, setDateData] = useState([]);
  const [, setArtData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [activeMainTab, setActiveMainTab] = useState('daily');
  const [selectedDate, setSelectedDate] = useState('全選');
  const [selectedSubDate, setSelectedSubDate] = useState('全選');
  const [selectedMember, setSelectedMember] = useState('全部');
  const [selectedFlightMember, setSelectedFlightMember] = useState('全部');
  const [noticeTab, setNoticeTab] = useState('files');

  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: '您好，我是秀傳AI小秘書。\n可直接查詢：\n- 3/15行程\n- 3/15誰回台灣\n- 晚餐在哪裡',
    },
  ]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    async function fetchCsv(url, label) {
      if (!url) return [];
      const res = await fetch(url);
      if (!res.ok) throw new Error(`無法讀取 ${label}：HTTP ${res.status}`);

      const text = await res.text();
      if (text.includes('<!DOCTYPE html') || text.includes('<html')) {
        throw new Error(`${label} 讀到的是 HTML，不是 CSV，請確認網址是否為 export?format=csv`);
      }

      return rowsToObjects(parseCSV(text));
    }

    async function fetchAllData() {
      try {
        setLoading(true);
        setLoadError('');

        const [
          tripObjects,
          peopleObjects,
          taskObjects,
          prepObjects,
          referenceObjects,
          dateObjects,
          artObjects,
        ] = await Promise.all([
          fetchCsv(TRIP_CSV_URL, 'web-行程規劃'),
          fetchCsv(PEOPLE_CSV_URL, 'web-人員'),
          fetchCsv(TASK_CSV_URL, 'web-任務'),
          fetchCsv(PREP_CSV_URL, 'web-行前準備'),
          fetchCsv(REFERENCE_CSV_URL, 'web-參考資料連結'),
          fetchCsv(DATE_CSV_URL, 'web-日期'),
          fetchCsv(ART_CSV_URL, 'web-美工'),
        ]);

        setTripData(mapTripRows(tripObjects));
        setPeopleData(mapPeopleRows(peopleObjects));
        setTaskData(mapTaskRows(taskObjects));
        setPrepData(mapSimpleRows(prepObjects));
        setReferenceData(mapReferenceRows(referenceObjects));
        setDateData(mapDateRows(dateObjects));
        setArtData(mapArtRows(artObjects));
      } catch (error) {
        console.error(error);
        setLoadError(error?.message || '資料載入失敗，請確認所有網址都是 CSV 匯出網址。');
      } finally {
        setLoading(false);
      }
    }

    fetchAllData();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  const allDates = useMemo(() => {
    const fromDateSheet = dateData.filter(Boolean);
    const fromTrip = tripData.map((item) => item.date).filter(Boolean);
    return ['全選', ...Array.from(new Set([...fromDateSheet, ...fromTrip])).sort()];
  }, [dateData, tripData]);

  const allMembers = useMemo(() => {
    const fromPeople = peopleData.map((p) => p.name).filter(Boolean);
    const fromTrip = tripData.flatMap((item) => splitMembers(item.members));
    const fromTask = taskData.map((item) => item.name).filter(Boolean);
    return ['全部', ...Array.from(new Set([...fromPeople, ...fromTrip, ...fromTask]))];
  }, [peopleData, tripData, taskData]);

  const memberFilteredTrip = useMemo(() => {
    if (selectedMember === '全部') return tripData;
    return tripData.filter((item) => includesMember(item.members, selectedMember));
  }, [tripData, selectedMember]);

  const dailyData = useMemo(() => {
    let result = [...memberFilteredTrip];
    if (selectedDate !== '全選') {
      result = result.filter((item) => item.date === selectedDate);
    }
    return result.sort(sortByDateTime);
  }, [memberFilteredTrip, selectedDate]);

  const mealData = useMemo(() => {
    let result = tripData.filter((item) => matchType(item, '餐會'));
    if (selectedSubDate !== '全選') result = result.filter((item) => item.date === selectedSubDate);
    return result.sort(sortByDateTime);
  }, [tripData, selectedSubDate]);

  const visitData = useMemo(() => {
    let result = tripData.filter((item) => matchType(item, '參訪'));
    if (selectedSubDate !== '全選') result = result.filter((item) => item.date === selectedSubDate);
    return result.sort(sortByDateTime);
  }, [tripData, selectedSubDate]);

  const stayData = useMemo(() => {
    let result = tripData.filter((item) => matchType(item, '住宿'));
    if (selectedSubDate !== '全選') result = result.filter((item) => item.date === selectedSubDate);
    return result.sort(sortByDateTime);
  }, [tripData, selectedSubDate]);

  const meetingRelatedData = useMemo(() => {
    let result = tripData.filter((item) => matchType(item, '會議相關'));
    if (selectedSubDate !== '全選') result = result.filter((item) => item.date === selectedSubDate);
    return result.sort(sortByDateTime);
  }, [tripData, selectedSubDate]);

  const conferenceData = useMemo(() => {
    let result = tripData.filter((item) => matchType(item, '會議'));
    if (selectedSubDate !== '全選') result = result.filter((item) => item.date === selectedSubDate);
    return result.sort(sortByDateTime);
  }, [tripData, selectedSubDate]);

  const internationalFlightData = useMemo(() => {
    return taskData.filter((item) => cleanText(item.name) || cleanText(item.fly));
  }, [taskData]);

  const filteredInternationalFlightData = useMemo(() => {
    if (selectedFlightMember === '全部') return internationalFlightData;
    return internationalFlightData.filter((item) => {
      const name = cleanText(item.name);
      return name === selectedFlightMember || name.includes(selectedFlightMember);
    });
  }, [internationalFlightData, selectedFlightMember]);

  const workAssignments = useMemo(() => {
    return peopleData.filter((person) => cleanText(person.name) || cleanText(person.task));
  }, [peopleData]);

  const dietInfoData = useMemo(() => {
    return taskData.filter(
      (item) => cleanText(item.name) || cleanText(item.diet) || cleanText(item.foodsAvoid)
    );
  }, [taskData]);

  const phoneData = useMemo(() => {
    return taskData.filter((item) => cleanText(item.name) || cleanText(item.phone));
  }, [taskData]);

  const tripPlanLink = useMemo(() => {
    const raw = referenceData.find((item) => cleanText(item.item).includes('出訪團規劃'))?.linkHref || '';
    return raw;
  }, [referenceData]);

  const himssHandbookLink = useMemo(() => {
    const raw =
      referenceData.find(
        (item) => cleanText(item.item).includes('HIMSS行程資料') || cleanText(item.item).includes('手冊')
      )?.linkHref || '';
    return raw;
  }, [referenceData]);

  const himssConferenceReferenceLink = useMemo(() => {
    const raw =
      referenceData.find((item) => cleanText(item.item).includes('HIMSS conference'))?.linkHref || '';
    return raw || HIMSS_CONFERENCE_URL;
  }, [referenceData]);

  const himssDailyLinks = useMemo(() => {
    return buildHimssDailyLinks(referenceData);
  }, [referenceData]);

  const travelNoticeItems = useMemo(() => {
    return referenceData.filter((item) => {
      const title = cleanText(item.item);
      return (
        title.includes('飛資得') ||
        title.includes('氣候') ||
        title.includes('電源') ||
        title.includes('旅行社') ||
        title.includes('聯繫') ||
        title.includes('注意事項')
      );
    });
  }, [referenceData]);

  const quickQuestions = [
    '3/15行程',
    '3/15誰回台灣',
    '晚餐在哪裡',
    'HIMSS會場在哪裡',
  ];

  function fallbackAnswer(q) {
    const query = normalizeQuestionTypos(q);

    if (!query) return '請先輸入問題。';

    if (query.includes('人員名單')) {
      const names = (peopleData || []).map((p) => p.name).filter(Boolean);
      return names.length ? `【人員名單】\n${names.join('、')}` : '目前無人員名單資料。';
    }

    if (query.includes('電話') || query.includes('電話號碼') || query.includes('聯絡電話')) {
      const rows = phoneData.filter((item) => cleanText(item.name) || cleanText(item.phone));
      if (!rows.length) return '目前無電話號碼資料。';
      return `【電話號碼】\n${rows
        .map((item) => `- ${item.name || '未填姓名'}：${item.phone || '未提供'}`)
        .join('\n')}`;
    }

    if (query.includes('禮品') || query.includes('準備')) {
      return prepData && prepData.length
        ? '【禮品準備】\n已有禮品準備與行前準備資料，請至「任務與準備」查看。'
        : '目前無禮品準備資料。';
    }

    if (query.includes('HIMSS')) {
      return himssConferenceReferenceLink
        ? `【HIMSS 官方資訊】\n連結：${himssConferenceReferenceLink}`
        : '目前無 HIMSS 官方資訊連結。';
    }

    if (query.includes('GTC')) {
      return GTC_CONFERENCE_URL
        ? `【GTC 官方網站】\n連結：${GTC_CONFERENCE_URL}`
        : '目前無 GTC 官方網站連結。';
    }

    const foundDate = extractDateTokenFromQuestion(query);

    if (foundDate && query.includes('行程')) {
      const items = tripData.filter((item) => item.date === foundDate).sort(sortByDateTime);
      if (!items.length) return `${foundDate} 目前沒有行程資料。`;

      return `【${foundDate} 行程】\n${items
        .map(
          (item) =>
            `- ${item.time || '時間未填'}｜${item.activity || '未命名行程'}${
              cleanText(item.locationDisplay || item.address)
                ? `｜${cleanText(item.locationDisplay || item.address)}`
                : ''
            }`
        )
        .join('\n')}`;
    }

    if (foundDate && query.includes('返台')) {
      const names = internationalFlightData
        .filter((item) => {
          const flyText = cleanText(item.fly);
          return (
            flyText.includes(foundDate) &&
            (flyText.includes('返程') ||
              flyText.includes('回程') ||
              flyText.includes('台北桃園') ||
              flyText.includes('桃園') ||
              flyText.includes('(TPE)') ||
              flyText.includes('台灣'))
          );
        })
        .map((item) => item.name)
        .filter(Boolean);

      return names.length
        ? `【${foundDate} 返台人員】\n${names.join('、')}`
        : `${foundDate} 目前無明確返台班機資料。`;
    }

    const allNames = [...new Set(peopleData.map((p) => p.name).filter(Boolean))];
    const foundMember = findBestMemberInQuestion(query, allNames);

    if (foundMember && query.includes('行程')) {
      const items = tripData
        .filter((item) => includesMember(item.members, foundMember))
        .sort(sortByDateTime);

      if (!items.length) return `${foundMember} 目前沒有行程資料。`;

      return `【${foundMember} 的行程】\n${items
        .map(
          (item) =>
            `- ${item.date} ${item.time || '時間未填'}｜${item.activity || '未命名行程'}${
              cleanText(item.locationDisplay || item.address)
                ? `｜${cleanText(item.locationDisplay || item.address)}`
                : ''
            }`
        )
        .join('\n')}`;
    }

    return (
      '目前尚未成功由 AI 精準回覆，先以基本規則回應。\n\n' +
      '可改問例如：\n- 3/15行程\n- 3/15誰回台灣\n- 晚餐在哪裡\n- 電話號碼'
    );
  }

  async function handleSendMessage(e, presetText) {
    if (e) e.preventDefault();

    const userText = cleanText(presetText ?? input);
    if (!userText) return;

    setThinking(true);
    setMessages((prev) => [...prev, { role: 'user', text: userText }]);

    if (!presetText) {
      setInput('');
    }

    try {
      const context = {
        tripData,
        peopleData,
        taskData,
        prepData,
        referenceData,
      };

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: userText,
          context,
          currentDate: new Date().toLocaleDateString('en-CA').replace(/-/g, '/'),
        }),
      });

      const rawText = await res.text();

      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(`API 回傳不是合法 JSON：${rawText || '空回應'}`);
      }

      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      setMessages((prev) => [...prev, { role: 'assistant', text: data.answer || 'AI 暫時沒有回應。' }]);
    } catch (error) {
      console.error('AI 呼叫失敗：', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text:
            `目前尚未成功連到 OpenAI API。\n錯誤訊息：${error?.message || '未知錯誤'}\n\n` +
            fallbackAnswer(userText),
        },
      ]);
    } finally {
      setThinking(false);
    }
  }

  function renderDateFilter() {
    return (
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {allDates.map((date) => (
          <button
            key={date}
            onClick={() => setSelectedSubDate(date)}
            className={`flex-shrink-0 rounded-2xl px-4 py-3 text-sm font-medium transition-all ${
              selectedSubDate === date
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {date}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="relative overflow-hidden bg-[radial-gradient(circle_at_top_right,_rgba(110,231,183,0.35),_transparent_28%),linear-gradient(135deg,#06121d_0%,#0b2d3f_45%,#0d6f6b_100%)] text-white shadow-xl">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute -right-10 -top-16 h-48 w-48 rounded-full bg-emerald-300 blur-3xl" />
          <div className="absolute left-8 top-12 h-32 w-32 rounded-full bg-cyan-300 blur-3xl" />
          <div className="absolute bottom-0 right-1/3 h-40 w-40 rounded-full bg-lime-300 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-emerald-100">
            <ShieldCheck size={14} />
            SMART TRAVEL ASSISTANT
          </div>

          <div className="mt-4 text-xl font-extrabold tracking-wide text-lime-100 md:text-2xl">
            秀傳醫療體系
          </div>

          <h1 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight md:text-5xl">
            2026 HIMSS+GTC 參訪團
          </h1>

          <p className="mt-4 max-w-4xl text-sm leading-7 text-emerald-50 md:text-base">
            手機優先的 AI 行程助理網站，整合每日行程、國際航空、餐會、參訪、住宿、會議資訊、文件連結與任務準備。
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-3 py-4 md:px-6 md:py-6">
        <section className="mb-4 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm md:mb-6 md:p-5">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {mainTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveMainTab(tab.key);
                  setSelectedSubDate('全選');
                }}
                className={`flex-shrink-0 rounded-2xl px-4 py-3 text-sm font-medium transition-all ${
                  activeMainTab === tab.key
                    ? 'bg-emerald-700 text-white shadow'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        {loading && <EmptyCard title="資料載入中..." />}
        {!loading && loadError && <EmptyCard title={loadError} />}

        {!loading && !loadError && activeMainTab === 'daily' && (
          <section className="space-y-4">
            <SectionCard
              title="每日行程"
              icon={<CalendarDays size={20} className="text-emerald-700" />}
              subtitle="可逐日查看全部安排，並依人員篩選。"
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_280px]">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {allDates.map((date) => (
                    <button
                      key={date}
                      onClick={() => setSelectedDate(date)}
                      className={`flex-shrink-0 rounded-2xl px-4 py-3 text-sm font-medium transition-all ${
                        selectedDate === date
                          ? 'bg-emerald-700 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {date}
                    </button>
                  ))}
                </div>

                <div>
                  <div className="mb-2 text-sm font-semibold text-slate-600">人員</div>
                  <select
                    value={selectedMember}
                    onChange={(e) => setSelectedMember(e.target.value)}
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {allMembers.map((member) => (
                      <option key={member} value={member}>
                        {member}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </SectionCard>

            {dailyData.length > 0 ? (
              dailyData.map((item, index) => (
                <InfoCard key={`${item.date}-${item.time}-${item.activity}-${index}`} item={item} />
              ))
            ) : (
              <EmptyCard title={`${selectedDate} 目前尚無符合條件的安排`} />
            )}
          </section>
        )}

        {!loading && !loadError && activeMainTab === 'flight' && (
          <section className="space-y-4">
            <SectionCard
              title="國際航空"
              icon={<Plane size={20} className="text-slate-700" />}
              subtitle="本頁以 web-任務 中的 name + fly 為主，供查詢出發、抵達與返台資訊。"
            >
              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[280px_1fr]">
                <div>
                  <div className="mb-2 text-sm font-semibold text-slate-600">人員篩選</div>
                  <select
                    value={selectedFlightMember}
                    onChange={(e) => setSelectedFlightMember(e.target.value)}
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {allMembers.map((member) => (
                      <option key={member} value={member}>
                        {member}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                {filteredInternationalFlightData.length > 0 ? (
                  filteredInternationalFlightData.map((person, idx) => (
                    <div key={`${person.name}-${idx}`} className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                      <div className="flex items-center gap-2 text-lg font-bold text-slate-800">
                        <Plane size={18} className="text-slate-500" />
                        {person.name}
                      </div>
                      <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                        {person.fly || '未提供班機資訊'}
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyCard title="目前無符合條件的國際航空資料" />
                )}
              </div>
            </SectionCard>
          </section>
        )}

        {!loading && !loadError && activeMainTab === 'meal' && (
          <section className="space-y-4">
            <SectionCard title="餐會" icon={<UtensilsCrossed size={20} className="text-amber-700" />}>
              {renderDateFilter()}
            </SectionCard>
            {mealData.length > 0 ? (
              mealData.map((item, index) => (
                <InfoCard key={`${item.date}-${item.time}-${item.activity}-${index}`} item={item} />
              ))
            ) : (
              <EmptyCard title="目前查無符合條件的餐會資料" />
            )}
          </section>
        )}

        {!loading && !loadError && activeMainTab === 'visit' && (
          <section className="space-y-4">
            <SectionCard title="參訪" icon={<Building2 size={20} className="text-violet-700" />}>
              {renderDateFilter()}
            </SectionCard>
            {visitData.length > 0 ? (
              visitData.map((item, index) => (
                <InfoCard key={`${item.date}-${item.time}-${item.activity}-${index}`} item={item} />
              ))
            ) : (
              <EmptyCard title="目前查無符合條件的參訪資料" />
            )}
          </section>
        )}

        {!loading && !loadError && activeMainTab === 'stay' && (
          <section className="space-y-4">
            <SectionCard title="住宿" icon={<MapPin size={20} className="text-emerald-700" />}>
              {renderDateFilter()}
            </SectionCard>
            {stayData.length > 0 ? (
              stayData.map((item, index) => (
                <InfoCard key={`${item.date}-${item.time}-${item.activity}-${index}`} item={item} />
              ))
            ) : (
              <EmptyCard title="目前查無符合條件的住宿資料" />
            )}
          </section>
        )}

        {!loading && !loadError && activeMainTab === 'meetingRelated' && (
          <section className="space-y-4">
            <SectionCard title="會議相關" icon={<FileText size={20} className="text-blue-700" />}>
              {renderDateFilter()}
            </SectionCard>
            {meetingRelatedData.length > 0 ? (
              meetingRelatedData.map((item, index) => (
                <InfoCard key={`${item.date}-${item.time}-${item.activity}-${index}`} item={item} />
              ))
            ) : (
              <EmptyCard title="目前查無符合條件的會議相關資料" />
            )}
          </section>
        )}

        {!loading && !loadError && activeMainTab === 'conference' && (
          <section className="space-y-4">
            <SectionCard
              title="Conference資訊"
              icon={<Cpu size={20} className="text-sky-700" />}
              subtitle="會議官方資訊、手冊與相關會場資料整合。"
            >
              {renderDateFilter()}
            </SectionCard>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectionCard title="HIMSS 官方資訊" icon={<BookOpen size={20} className="text-sky-700" />}>
                <p className="text-sm leading-6 text-slate-600">
                  2026 HIMSS conference 官方資訊與議程參考。
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={himssConferenceReferenceLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-2xl bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800"
                  >
                    <ExternalLink size={16} />
                    開啟 HIMSS 官方資訊
                  </a>
                  {himssHandbookLink ? (
                    <a
                      href={himssHandbookLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-2xl bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800"
                    >
                      <FileText size={16} />
                      開啟 HIMSS 手冊
                    </a>
                  ) : (
                    <div className="text-sm text-rose-600">資料問題：HIMSS 手冊連結尚未提供有效網址</div>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="GTC 2026 官方網站" icon={<Globe size={20} className="text-green-700" />}>
                <p className="text-sm leading-6 text-slate-600">
                  NVIDIA GTC 官方網站，供查看主題、議程、Keynote 與官方公告。
                </p>
                <div className="mt-4">
                  <a
                    href={GTC_CONFERENCE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-2xl bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
                  >
                    <ExternalLink size={16} />
                    開啟 GTC 官方網站
                  </a>
                </div>
              </SectionCard>
            </div>

            {conferenceData.length > 0 ? (
              conferenceData.map((item, index) => (
                <InfoCard key={`${item.date}-${item.time}-${item.activity}-${index}`} item={item} />
              ))
            ) : (
              <EmptyCard title="目前查無符合條件的會議資料" />
            )}
          </section>
        )}

        {!loading && !loadError && activeMainTab === 'taskPrep' && (
          <section className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectionCard
                title="工作分派"
                icon={<ClipboardList size={20} className="text-emerald-700" />}
                subtitle="依 web-人員 顯示 name + task。"
              >
                <div className="space-y-3">
                  {workAssignments.length > 0 ? (
                    workAssignments.map((person, idx) => (
                      <div key={`${person.name}-${idx}`} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                        <div className="font-bold leading-7 text-slate-800">
                          {person.name}
                          {person.task ? `　${person.task}` : ''}
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyCard title="目前無工作分派資料" />
                  )}
                </div>
              </SectionCard>

              <SectionCard
                title="禮品準備與行前準備"
                icon={<Gift size={20} className="text-amber-700" />}
                subtitle="前端採通用欄位渲染，不綁死舊欄位結構。"
              >
                <div className="space-y-3">
                  {prepData.length > 0 ? (
                    prepData.map((row, idx) => <SimpleKeyValueCard key={idx} data={row} />)
                  ) : (
                    <EmptyCard title="目前無準備資訊資料" />
                  )}
                </div>
              </SectionCard>
            </div>
          </section>
        )}

        {!loading && !loadError && activeMainTab === 'notice' && (
          <section className="grid grid-cols-1 gap-4">
            <SectionCard
              title="重要資訊與注意事項"
              icon={<AlertCircle size={20} className="text-amber-700" />}
              subtitle="包含出訪文件、飲食資訊、電話號碼與行程注意事項。"
            >
              <div className="mb-5 flex flex-wrap gap-2">
                <button
                  onClick={() => setNoticeTab('files')}
                  className={`rounded-2xl px-4 py-2 text-sm font-medium ${
                    noticeTab === 'files'
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  出訪團相關資訊文件
                </button>
                <button
                  onClick={() => setNoticeTab('diet')}
                  className={`rounded-2xl px-4 py-2 text-sm font-medium ${
                    noticeTab === 'diet'
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  飲食資訊
                </button>
                <button
                  onClick={() => setNoticeTab('phone')}
                  className={`rounded-2xl px-4 py-2 text-sm font-medium ${
                    noticeTab === 'phone'
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  電話號碼
                </button>
                <button
                  onClick={() => setNoticeTab('travel')}
                  className={`rounded-2xl px-4 py-2 text-sm font-medium ${
                    noticeTab === 'travel'
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  行程注意事項
                </button>
              </div>

              {noticeTab === 'files' && (
                <div className="space-y-4">
                  {tripPlanLink && (
                    <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4">
                      <div className="text-base font-bold text-slate-800">2026 HIMSS+GTC 出訪團規劃</div>
                      <div className="mt-2 text-sm leading-6 text-slate-600">
                        包含責任義務、返國附件、繳交與出訪相關規範。
                      </div>
                      <div className="mt-3">
                        <a
                          href={tripPlanLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
                        >
                          <FileText size={16} />
                          開啟文件
                        </a>
                      </div>
                    </div>
                  )}

                  <div className="rounded-3xl border border-sky-100 bg-sky-50 p-4">
                    <div className="text-base font-bold text-slate-800">HIMSS 03/09–03/12</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {['3/9', '3/10', '3/11', '3/12'].map((day) =>
                        himssDailyLinks[day] ? (
                          <a
                            key={day}
                            href={himssDailyLinks[day]}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-2xl bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800"
                          >
                            <BookOpen size={16} />
                            {day}
                          </a>
                        ) : (
                          <span
                            key={day}
                            className="inline-flex items-center gap-2 rounded-2xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-500"
                          >
                            {day}
                          </span>
                        )
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {referenceData
                      .filter((item) => {
                        const title = cleanText(item.item);
                        return !/0309|03\/09|3\/9|0310|03\/10|3\/10|0311|03\/11|3\/11|0312|03\/12|3\/12/i.test(title);
                      })
                      .map((item, index) => (
                        <div key={`${item.item}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                          <div className="text-sm font-bold text-slate-800">{item.item || '未命名項目'}</div>
                          {item.content && (
                            <div className="mt-2 text-sm leading-6 text-slate-600">{item.content}</div>
                          )}
                          {item.linkHref ? (
                            <div className="mt-3">
                              <a
                                href={item.linkHref}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 rounded-2xl bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
                              >
                                <ExternalLink size={16} />
                                開啟連結
                              </a>
                            </div>
                          ) : item.link ? (
                            <div className="mt-2 text-sm text-rose-600">資料問題：此筆連結不是有效網址</div>
                          ) : null}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {noticeTab === 'diet' && (
                <div className="grid gap-3">
                  {dietInfoData.length > 0 ? (
                    dietInfoData.map((item, index) => (
                      <div key={`${item.name}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                        <div className="text-base font-bold text-slate-800">{item.name}</div>
                        <div className="mt-2 text-sm text-slate-700">
                          <span className="font-semibold">飲食類別：</span>
                          {item.diet || '未提供'}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">
                          <span className="font-semibold">禁忌：</span>
                          {item.foodsAvoid || '無'}
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyCard title="目前無飲食資訊資料" />
                  )}
                </div>
              )}

              {noticeTab === 'phone' && (
                <div className="grid gap-3">
                  {phoneData.length > 0 ? (
                    phoneData.map((item, index) => (
                      <div key={`${item.name}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                        <div className="flex items-center gap-2 text-base font-bold text-slate-800">
                          <Phone size={16} className="text-emerald-700" />
                          {item.name || '未填姓名'}
                        </div>
                        <div className="mt-2 text-sm text-slate-700">
                          <span className="font-semibold">電話：</span>
                          {item.phone || '未提供'}
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyCard title="目前無電話號碼資料" />
                  )}
                </div>
              )}

              {noticeTab === 'travel' && (
                <div className="space-y-4">
                  {himssHandbookLink && (
                    <div className="rounded-3xl border border-indigo-100 bg-indigo-50 p-4">
                      <div className="text-base font-bold text-slate-800">HIMSS行程資料、飛資得</div>
                      <div className="mt-2 text-sm leading-6 text-slate-600">
                        建議先查看完整文件，確認氣候、電源、旅行社聯繫窗口、交通集合與其他旅遊注意事項。
                      </div>
                      <div className="mt-3">
                        <a
                          href={himssHandbookLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-2xl bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800"
                        >
                          <FileText size={16} />
                          開啟 HIMSS行程資料、飛資得
                        </a>
                      </div>
                    </div>
                  )}

                  {travelNoticeItems.length > 0 ? (
                    travelNoticeItems.map((item, index) => (
                      <div key={`${item.item}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                        <div className="text-sm font-bold text-slate-800">{item.item}</div>
                        {item.content && (
                          <div className="mt-2 text-sm leading-6 text-slate-600">{item.content}</div>
                        )}
                        {item.linkHref ? (
                          <div className="mt-3">
                            <a
                              href={item.linkHref}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-2xl bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
                            >
                              <ExternalLink size={16} />
                              開啟連結
                            </a>
                          </div>
                        ) : item.link ? (
                          <div className="mt-2 text-sm text-rose-600">資料問題：此筆連結不是有效網址</div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm leading-7 text-slate-600">
                      目前 `web-參考資料連結` 尚未提供可摘要的內容欄位。
                    </div>
                  )}
                </div>
              )}
            </SectionCard>
          </section>
        )}

        {!loading && !loadError && activeMainTab === 'ai' && (
          <section className="grid grid-cols-1 gap-4">
            <SectionCard
              title="AI 助手"
              icon={<Bot size={22} className="text-emerald-700" />}
              subtitle="可直接詢問地址、地點、某日全部行程、返台班機、某人安排、電話與文件資訊。"
            >
              <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[320px_1fr]">
                <div className="rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,#f0fdf4_0%,#ecfeff_100%)] p-5 shadow-sm">
                  <div className="space-y-4 text-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-white/70 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-emerald-600">
                      <MessageCircle size={14} />
                      AI CUSTOMER ASSISTANT
                    </div>

                    <img
                      src="/xiuchuan-ai-secretary.png"
                      alt="秀傳AI小秘書"
                      className="mx-auto w-48 md:w-56 lg:w-60 drop-shadow-lg"
                    />

                    <div className="text-2xl font-bold text-emerald-700">秀傳AI小秘書</div>

                    <p className="text-sm leading-7 text-slate-600">
                      協助查詢行程、地址、地圖、班機、電話、文件與禮品準備。
                    </p>

                    <div className="flex items-center justify-center gap-2 text-sm text-emerald-700">
                      <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
                      AI 即時服務中
                    </div>

                    <div className="rounded-2xl border border-white/70 bg-white/70 p-4 text-left">
                      <div className="mb-3 text-sm font-semibold text-slate-700">快速提問</div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {quickQuestions.map((q) => (
                          <button
                            key={q}
                            onClick={() => handleSendMessage(null, q)}
                            className="inline-flex flex-shrink-0 items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50"
                          >
                            <Sparkles size={15} />
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex h-[620px] flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-4 py-4 md:px-5">
                    <p className="text-sm leading-7 text-slate-600 md:text-base">
                      可直接詢問地址、地點、某日全部行程、返台班機、某人相關安排、電話號碼、文件與官方資訊。
                    </p>
                  </div>

                  <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 md:px-5">
                    {messages.map((message, idx) => (
                      <div
                        key={`${message.role}-${idx}`}
                        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[92%] rounded-3xl px-4 py-3 text-sm ${
                            message.role === 'user'
                              ? 'bg-emerald-700 text-white'
                              : 'border border-slate-200 bg-slate-50 text-slate-700'
                          }`}
                        >
                          {message.role === 'assistant' && (
                            <div className="mb-3 flex items-center gap-2 text-xs font-bold text-emerald-700">
                              <img
                                src="/xiuchuan-ai-secretary.png"
                                alt="AI"
                                className="h-6 w-6 rounded-full object-cover"
                              />
                              AI 回覆
                            </div>
                          )}

                          {message.role === 'assistant' ? (
                            <AIAnswerContent text={message.text} />
                          ) : (
                            <div className="whitespace-pre-wrap leading-7">{message.text}</div>
                          )}
                        </div>
                      </div>
                    ))}

                    {thinking && (
                      <div className="flex justify-start">
                        <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                          <div className="flex items-center gap-2">
                            <Bot size={16} className="animate-pulse text-emerald-700" />
                            <div>AI 思考中...</div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div ref={chatEndRef} />
                  </div>

                  <form onSubmit={handleSendMessage} className="border-t border-slate-100 p-4 md:p-5">
                    <div className="flex gap-2">
                      <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="例如：電話號碼、3/15誰回台灣"
                        className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <button
                        type="submit"
                        disabled={thinking}
                        className="inline-flex items-center justify-center rounded-2xl bg-emerald-700 px-4 py-3 text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-400"
                      >
                        <Send size={18} />
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </SectionCard>
          </section>
        )}
      </main>
    </div>
  );
}
