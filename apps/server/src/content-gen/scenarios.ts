import type { ContentGenerationRequestV1, ContentGenerationResultV1, JsonObject } from './contract.js';
import { CATALOG_VERSION } from './contract.js';

/**
 * Six domains, six locales, hand-authored — the seed corpus the synthesizer
 * expands into the training set.
 *
 * Deliberately NOT cookies-only. Stage 2 has no idea what a recipe is; if
 * every example came from one domain the model would learn the domain's
 * vocabulary rather than the contract's shape (fill exactly these fields,
 * exactly these lengths, plain text, nothing else). `study_planner` doubles as
 * the contract's own "new cross-domain page" example, so passing it here is
 * also a rehearsal for that proof.
 *
 * Locale honesty: en-US/es-ES/fr-FR/de-DE below are ordinary sentences I am
 * confident in. ja-JP and ar-SA are deliberately short, common, low-risk
 * phrases — seed data to prove the pipeline is locale-parameterised, NOT
 * native-speaker-reviewed copy. Flagged again in stage-2-contract.md; get a
 * native speaker to pass over both before they influence a shipped model.
 */
export const LOCALES = ['en-US', 'es-ES', 'fr-FR', 'de-DE', 'ja-JP', 'ar-SA'] as const;
export type Locale = (typeof LOCALES)[number];

export type ScenarioPair = {
  request: ContentGenerationRequestV1;
  result: ContentGenerationResultV1;
};

type Builder = (locale: Locale, requestId: string) => ScenarioPair;

const req = (
  requestId: string,
  locale: Locale,
  intent: string,
  context: JsonObject,
  targets: ContentGenerationRequestV1['targets'],
): ContentGenerationRequestV1 => ({
  contract: 'jit.content.request.v1',
  requestId,
  catalogVersion: CATALOG_VERSION,
  locale,
  intent,
  context,
  targets,
});

const res = (
  requestId: string,
  values: ContentGenerationResultV1['values'],
): ContentGenerationResultV1 => ({
  contract: 'jit.content.result.v1',
  requestId,
  catalogVersion: CATALOG_VERSION,
  values,
});

/* ------------------------------------------------------------------ *
 * 1. cookie_recipe — the demo domain, kept as one example among six
 * ------------------------------------------------------------------ */

const cookieRecipe: Builder = (locale, requestId) => {
  const copy: Record<Locale, { title: string; subtitle: string; axis: string; ingLabel: string; flour: string; butter: string; begin: string; preview: string }> = {
    'en-US': { title: 'Classic Chocolate Chip', subtitle: 'A weeknight favourite, ready in 35 minutes.', axis: 'Batch size', ingLabel: 'Ingredients', flour: 'Plain flour', butter: 'Butter', begin: 'Start baking', preview: 'finished cookies, cooling rack' },
    'es-ES': { title: 'Galletas Clásicas de Chocolate', subtitle: 'Un clásico entre semana, listo en 35 minutos.', axis: 'Tamaño del lote', ingLabel: 'Ingredientes', flour: 'Harina común', butter: 'Mantequilla', begin: 'Empezar a hornear', preview: 'galletas listas, en la rejilla' },
    'fr-FR': { title: 'Cookies Classiques au Chocolat', subtitle: 'Un classique de la semaine, prêt en 35 minutes.', axis: 'Taille du lot', ingLabel: 'Ingrédients', flour: 'Farine ordinaire', butter: 'Beurre', begin: 'Commencer la cuisson', preview: 'cookies prêts, sur la grille' },
    'de-DE': { title: 'Klassische Schokoladenkekse', subtitle: 'Ein Wochenklassiker, fertig in 35 Minuten.', axis: 'Menge', ingLabel: 'Zutaten', flour: 'Weizenmehl', butter: 'Butter', begin: 'Backen beginnen', preview: 'fertige Kekse auf dem Rost' },
    'ja-JP': { title: 'クラシック チョコチップクッキー', subtitle: '35分で作れる定番のおやつです。', axis: '分量', ingLabel: '材料', flour: '小麦粉', butter: 'バター', begin: '焼き始める', preview: '焼き上がったクッキー' },
    'ar-SA': { title: 'كعك الشوكولاتة الكلاسيكي', subtitle: 'وصفة سهلة تجهز خلال 35 دقيقة.', axis: 'حجم الدفعة', ingLabel: 'المكونات', flour: 'دقيق أبيض', butter: 'زبدة', begin: 'ابدأ الخَبز', preview: 'الكعك جاهز على الشبكة' },
  };
  const c = copy[locale];
  const targets: ContentGenerationRequestV1['targets'] = [
    { elementId: 'title', component: 'Heading', purpose: 'Recipe name', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 60, format: 'plain-text' } }], fixed: { level: 1 } },
    { elementId: 'subtitle', component: 'Text', purpose: 'One-line pitch for the recipe', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 220, format: 'plain-text' } }], fixed: { tone: 'muted' } },
    { elementId: 'axis', component: 'Slider', purpose: 'Batch-size control label', fields: [{ name: 'label', type: 'string', required: true, constraints: { minLength: 1, maxLength: 24, format: 'plain-text' } }], fixed: { min: 12, max: 30, step: 6, value: 30, unit: 'cookies' } },
    // The only Media target in the corpus: its sole field (`caption`) is
    // optional, so this is also where "optional present vs omitted" gets
    // exercised for a component whose GENERATABLE field is optional itself,
    // not just a secondary field on an otherwise-required target.
    { elementId: 'preview', component: 'Media', purpose: 'Alt text for the recipe preview image', fields: [{ name: 'caption', type: 'string', required: false, constraints: { minLength: 1, maxLength: 40, format: 'plain-text' } }], fixed: { src: 'https://example.com/preview.jpg' } },
    { elementId: 'ing-label', component: 'Label', purpose: 'Ingredients section heading', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 24, format: 'plain-text' } }], fixed: {} },
    { elementId: 'ing-1', component: 'ListItem', purpose: 'First ingredient row', fields: [{ name: 'title', type: 'string', required: true, constraints: { minLength: 1, maxLength: 40, format: 'plain-text' } }], fixed: { meta: '3⅓ cups' } },
    { elementId: 'ing-2', component: 'ListItem', purpose: 'Second ingredient row', fields: [{ name: 'title', type: 'string', required: true, constraints: { minLength: 1, maxLength: 40, format: 'plain-text' } }], fixed: { meta: '1⅔ cups' } },
    { elementId: 'begin', component: 'Button', purpose: 'Primary action: start the recipe', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 24, format: 'plain-text' } }], fixed: { variant: 'primary' } },
  ];
  return {
    request: req(requestId, locale, 'Show the selected cookie recipe', { recipeName: c.title }, targets),
    result: res(requestId, {
      title: { text: c.title },
      subtitle: { text: c.subtitle },
      preview: { caption: c.preview },
      axis: { label: c.axis },
      'ing-label': { text: c.ingLabel },
      'ing-1': { title: c.flour },
      'ing-2': { title: c.butter },
      begin: { text: c.begin },
    }),
  };
};

/* ------------------------------------------------------------------ *
 * 2. train_ticket
 * ------------------------------------------------------------------ */

const trainTicket: Builder = (locale, requestId) => {
  const copy: Record<Locale, { operator: string; title: string; summary: string; origin: string; destination: string; seat: string; view: string }> = {
    'en-US': { operator: 'National Rail · E-ticket', title: 'London to Edinburgh', summary: 'Direct service, about 4 hours 22 minutes.', origin: "King's Cross", destination: 'Waverley', seat: 'Standard · Coach C', view: 'View ticket' },
    'es-ES': { operator: 'Renfe · e-billete', title: 'Madrid a Barcelona', summary: 'Trayecto directo, unas 2 horas 30 minutos.', origin: 'Atocha', destination: 'Sants', seat: 'Turista · Coche 4', view: 'Ver billete' },
    'fr-FR': { operator: 'SNCF · Billet élec.', title: 'Paris à Lyon', summary: 'Trajet direct, environ 2 heures.', origin: 'Gare de Lyon', destination: 'Part-Dieu', seat: 'Seconde · Voiture 12', view: 'Voir le billet' },
    'de-DE': { operator: 'Deutsche Bahn · E-Ticket', title: 'Berlin nach München', summary: 'Direktverbindung, etwa 4 Stunden.', origin: 'Hauptbahnhof', destination: 'Hauptbahnhof', seat: '2. Klasse · Wagen 8', view: 'Ticket ansehen' },
    'ja-JP': { operator: 'JR ・ 電子チケット', title: '東京から京都', summary: '直通列車、約2時間15分。', origin: '東京駅', destination: '京都駅', seat: '普通車・8号車', view: 'チケットを見る' },
    'ar-SA': { operator: 'الخط السريع · تذكرة', title: 'من الرياض إلى جدة', summary: 'رحلة مباشرة، حوالي ساعتين.', origin: 'محطة الرياض', destination: 'محطة جدة', seat: 'اقتصادي · عربة 3', view: 'عرض التذكرة' },
  };
  const c = copy[locale];
  const targets: ContentGenerationRequestV1['targets'] = [
    { elementId: 'operator', component: 'Label', purpose: 'Operator and ticket type', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 24, format: 'plain-text' } }], fixed: {} },
    { elementId: 'title', component: 'Heading', purpose: 'Route, origin to destination', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 60, format: 'plain-text' } }], fixed: { level: 1 } },
    { elementId: 'summary', component: 'Text', purpose: 'Journey summary', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 220, format: 'plain-text' } }], fixed: { tone: 'muted' } },
    { elementId: 'origin', component: 'Metric', purpose: 'Departure station label', fields: [{ name: 'label', type: 'string', required: true, constraints: { minLength: 1, maxLength: 28, format: 'plain-text' } }], fixed: { value: '08:30' } },
    { elementId: 'destination', component: 'Metric', purpose: 'Arrival station label', fields: [{ name: 'label', type: 'string', required: true, constraints: { minLength: 1, maxLength: 28, format: 'plain-text' } }], fixed: { value: '12:52' } },
    { elementId: 'seat', component: 'Rule', purpose: 'Fare class and seat', fields: [{ name: 'left', type: 'string', required: true, constraints: { minLength: 1, maxLength: 40, format: 'plain-text' } }], fixed: { right: 'K9QP2' } },
    { elementId: 'view', component: 'Button', purpose: 'Open the full ticket', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 24, format: 'plain-text' } }], fixed: { variant: 'primary' } },
  ];
  return {
    request: req(requestId, locale, 'Show my train ticket', { route: c.title }, targets),
    result: res(requestId, {
      operator: { text: c.operator },
      title: { text: c.title },
      summary: { text: c.summary },
      origin: { label: c.origin },
      destination: { label: c.destination },
      seat: { left: c.seat },
      view: { text: c.view },
    }),
  };
};

/* ------------------------------------------------------------------ *
 * 3. study_planner — the contract's own cross-domain proof
 * ------------------------------------------------------------------ */

const studyPlanner: Builder = (locale, requestId) => {
  const copy: Record<Locale, { title: string; subject: string; goalLabel: string; goalPh: string; reminder: string; duration: string; min: string; max: string; start: string }> = {
    'en-US': { title: 'Study session', subject: 'Org. Chemistry', goalLabel: 'Focus for today', goalPh: 'e.g. reaction mechanisms', reminder: 'Remind me to stretch', duration: 'Session length', min: 'Short', max: 'Deep focus', start: 'Start studying' },
    'es-ES': { title: 'Sesión de estudio', subject: 'Química Orgánica', goalLabel: 'Objetivo de hoy', goalPh: 'p. ej. mecanismos de reacción', reminder: 'Recuérdame estirar', duration: 'Duración', min: 'Corta', max: 'Máxima atención', start: 'Empezar a estudiar' },
    'fr-FR': { title: "Session d'étude", subject: 'Chimie Organique', goalLabel: "Objectif du jour", goalPh: 'ex. mécanismes réactionnels', reminder: "Rappelle-moi de m'étirer", duration: 'Durée', min: 'Courte', max: 'Concentration+', start: "Commencer à étudier" },
    'de-DE': { title: 'Lernsitzung', subject: 'Org. Chemie', goalLabel: 'Heutiges Ziel', goalPh: 'z. B. Reaktionsmechanismen', reminder: 'Erinnere mich ans Dehnen', duration: 'Dauer', min: 'Kurz', max: 'Volle Konzentr.', start: 'Lernen beginnen' },
    'ja-JP': { title: '学習セッション', subject: '有機化学', goalLabel: '今日の目標', goalPh: '例：反応機構', reminder: 'ストレッチを知らせる', duration: '長さ', min: '短め', max: '集中モード', start: '学習を始める' },
    'ar-SA': { title: 'جلسة مذاكرة', subject: 'الكيمياء العضوية', goalLabel: 'هدف اليوم', goalPh: 'مثال: آليات التفاعل', reminder: 'ذكّرني بالتمدد', duration: 'مدة الجلسة', min: 'قصيرة', max: 'تركيز عميق', start: 'ابدأ المذاكرة' },
  };
  const c = copy[locale];
  const targets: ContentGenerationRequestV1['targets'] = [
    { elementId: 'title', component: 'Heading', purpose: 'Screen title', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 60, format: 'plain-text' } }], fixed: { level: 1 } },
    { elementId: 'subject', component: 'Badge', purpose: 'Subject tag', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 16, format: 'plain-text' } }], fixed: {} },
    { elementId: 'goal', component: 'TextField', purpose: "Today's study focus", fields: [
      { name: 'label', type: 'string', required: true, constraints: { minLength: 1, maxLength: 24, format: 'plain-text' } },
      { name: 'placeholder', type: 'string', required: false, constraints: { minLength: 1, maxLength: 40, format: 'plain-text' } },
    ], fixed: {} },
    { elementId: 'reminder', component: 'Toggle', purpose: 'Stretch break reminder', fields: [{ name: 'label', type: 'string', required: true, constraints: { minLength: 1, maxLength: 32, format: 'plain-text' } }], fixed: { on: true } },
    { elementId: 'duration', component: 'Slider', purpose: 'Session length control', fields: [
      { name: 'label', type: 'string', required: true, constraints: { minLength: 1, maxLength: 24, format: 'plain-text' } },
      { name: 'minLabel', type: 'string', required: false, constraints: { minLength: 1, maxLength: 16, format: 'plain-text' } },
      { name: 'maxLabel', type: 'string', required: false, constraints: { minLength: 1, maxLength: 16, format: 'plain-text' } },
    ], fixed: { min: 15, max: 90, step: 15, value: 45, unit: 'min' } },
    { elementId: 'start', component: 'Button', purpose: 'Begin the session', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 24, format: 'plain-text' } }], fixed: { variant: 'primary' } },
  ];
  return {
    request: req(requestId, locale, 'Start a focused study session', { subject: c.subject }, targets),
    result: res(requestId, {
      title: { text: c.title },
      subject: { text: c.subject },
      goal: { label: c.goalLabel, placeholder: c.goalPh },
      reminder: { label: c.reminder },
      duration: { label: c.duration, minLabel: c.min, maxLabel: c.max },
      start: { text: c.start },
    }),
  };
};

/* ------------------------------------------------------------------ *
 * 4. travel_rebooking — the urgent-conference beat from the pivot notes
 * ------------------------------------------------------------------ */

const travelRebooking: Builder = (locale, requestId) => {
  const copy: Record<Locale, { title: string; diagnosis: string; outcome: string; opt1: string; opt2: string; primary: string; secondary: string }> = {
    'en-US': { title: 'You need to be in Chicago tomorrow', diagnosis: "Your manager just asked you to attend a conference starting 9am tomorrow.", outcome: 'Fastest option arrives', opt1: 'Flight · 6:10am departure', opt2: 'Train · overnight, arrives 7am', primary: 'Book the flight', secondary: 'See more options' },
    'es-ES': { title: 'Debes estar en Chicago mañana', diagnosis: 'Tu jefe te pidió asistir a una conferencia que empieza mañana a las 9.', outcome: 'La opción más rápida llega', opt1: 'Vuelo · sale a las 6:10', opt2: 'Tren · nocturno, llega a las 7', primary: 'Reservar el vuelo', secondary: 'Ver más opciones' },
    'fr-FR': { title: 'Vous devez être à Chicago demain', diagnosis: 'Votre responsable vous demande d’assister à une conférence dès 9h demain.', outcome: "L'option la plus rapide", opt1: 'Vol · départ à 6h10', opt2: 'Train · de nuit, arrivée à 7h', primary: 'Réserver le vol', secondary: "Voir d'autres options" },
    'de-DE': { title: 'Sie müssen morgen in Chicago sein', diagnosis: 'Ihr Vorgesetzter bittet Sie, morgen um 9 Uhr an einer Konferenz teilzunehmen.', outcome: 'Schnellste Option kommt an', opt1: 'Flug · Abflug 6:10 Uhr', opt2: 'Zug · über Nacht, Ankunft 7 Uhr', primary: 'Flug buchen', secondary: 'Weitere Optionen ansehen' },
    'ja-JP': { title: '明日シカゴに行く必要があります', diagnosis: '上司から明日午前9時開始の会議への出席を頼まれました。', outcome: '最速の到着案', opt1: '飛行機・6時10分発', opt2: '列車・夜行、7時到着', primary: 'フライトを予約', secondary: '他の案を見る' },
    'ar-SA': { title: 'يجب أن تكون في شيكاغو غداً', diagnosis: 'طلب منك مديرك حضور مؤتمر يبدأ التاسعة صباح الغد.', outcome: 'أسرع خيار للوصول', opt1: 'رحلة جوية · الإقلاع 6:10', opt2: 'قطار · ليلي، الوصول 7 صباحاً', primary: 'احجز الرحلة', secondary: 'عرض خيارات أخرى' },
  };
  const c = copy[locale];
  const targets: ContentGenerationRequestV1['targets'] = [
    { elementId: 'title', component: 'Heading', purpose: 'What changed and why it matters', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 60, format: 'plain-text' } }], fixed: { level: 1 } },
    { elementId: 'diagnosis', component: 'Alert', purpose: 'Explain the new constraint', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 140, format: 'plain-text' } }], fixed: {} },
    { elementId: 'outcome', component: 'Metric', purpose: 'Framing for the recommended option', fields: [{ name: 'label', type: 'string', required: true, constraints: { minLength: 1, maxLength: 28, format: 'plain-text' } }], fixed: { value: '7:00 AM' } },
    { elementId: 'opt-1', component: 'ListItem', purpose: 'Recommended travel option', fields: [{ name: 'title', type: 'string', required: true, constraints: { minLength: 1, maxLength: 40, format: 'plain-text' } }], fixed: { meta: '$210' } },
    { elementId: 'opt-2', component: 'ListItem', purpose: 'Alternative travel option', fields: [{ name: 'title', type: 'string', required: true, constraints: { minLength: 1, maxLength: 40, format: 'plain-text' } }], fixed: { meta: '$95' } },
    { elementId: 'primary', component: 'Button', purpose: 'Confirm the recommended option', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 24, format: 'plain-text' } }], fixed: { variant: 'primary' } },
    { elementId: 'secondary', component: 'Button', purpose: 'See alternatives', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 24, format: 'plain-text' } }], fixed: { variant: 'ghost' } },
  ];
  return {
    request: req(requestId, locale, 'Urgent: need to travel for a conference tomorrow', { city: 'Chicago' }, targets),
    result: res(requestId, {
      title: { text: c.title },
      diagnosis: { text: c.diagnosis },
      outcome: { label: c.outcome },
      'opt-1': { title: c.opt1 },
      'opt-2': { title: c.opt2 },
      primary: { text: c.primary },
      secondary: { text: c.secondary },
    }),
  };
};

/* ------------------------------------------------------------------ *
 * 5. comfort_settings — Toggle-heavy, mirrors the accessibility framing
 * ------------------------------------------------------------------ */

const comfortSettings: Builder = (locale, requestId) => {
  const copy: Record<Locale, { title: string; motion: string; metrics: string; text: string; notify: string }> = {
    'en-US': { title: 'Comfort', motion: 'Reduce motion', metrics: 'Hide metrics', text: 'Larger text', notify: 'Mute notifications' },
    'es-ES': { title: 'Comodidad', motion: 'Reducir movimiento', metrics: 'Ocultar métricas', text: 'Texto más grande', notify: 'Silenciar notificaciones' },
    'fr-FR': { title: 'Confort', motion: 'Réduire les animations', metrics: 'Masquer les indicateurs', text: 'Texte plus grand', notify: 'Couper les notifications' },
    'de-DE': { title: 'Komfort', motion: 'Bewegung reduzieren', metrics: 'Kennzahlen ausblenden', text: 'Größerer Text', notify: 'Benachrichtigungen stummschalten' },
    'ja-JP': { title: '快適設定', motion: 'アニメーションを減らす', metrics: '数値を非表示', text: '文字を大きく', notify: '通知をミュート' },
    'ar-SA': { title: 'الراحة', motion: 'تقليل الحركة', metrics: 'إخفاء المؤشرات', text: 'تكبير النص', notify: 'كتم الإشعارات' },
  };
  const c = copy[locale];
  const targets: ContentGenerationRequestV1['targets'] = [
    { elementId: 'title', component: 'Heading', purpose: 'Panel title', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 60, format: 'plain-text' } }], fixed: { level: 2 } },
    { elementId: 'toggle-1', component: 'Toggle', purpose: 'Reduce motion setting', fields: [{ name: 'label', type: 'string', required: true, constraints: { minLength: 1, maxLength: 32, format: 'plain-text' } }], fixed: { on: true } },
    { elementId: 'toggle-2', component: 'Toggle', purpose: 'Hide numeric metrics', fields: [{ name: 'label', type: 'string', required: true, constraints: { minLength: 1, maxLength: 32, format: 'plain-text' } }], fixed: { on: true } },
    { elementId: 'toggle-3', component: 'Toggle', purpose: 'Increase text size', fields: [{ name: 'label', type: 'string', required: true, constraints: { minLength: 1, maxLength: 32, format: 'plain-text' } }], fixed: { on: true } },
    { elementId: 'toggle-4', component: 'Toggle', purpose: 'Mute notifications', fields: [{ name: 'label', type: 'string', required: true, constraints: { minLength: 1, maxLength: 32, format: 'plain-text' } }], fixed: { on: false } },
  ];
  return {
    request: req(requestId, locale, 'Make it softer and calmer', {}, targets),
    result: res(requestId, {
      title: { text: c.title },
      'toggle-1': { label: c.motion },
      'toggle-2': { label: c.metrics },
      'toggle-3': { label: c.text },
      'toggle-4': { label: c.notify },
    }),
  };
};

/* ------------------------------------------------------------------ *
 * 6. share_message — crossing out of the originating domain
 * ------------------------------------------------------------------ */

const shareMessage: Builder = (locale, requestId) => {
  const copy: Record<Locale, { title: string; tone: string; casual: string; polished: string; name1: string; body1: string; name2: string; body2: string; send: string }> = {
    'en-US': { title: 'Two messages', tone: 'Tone', casual: 'Casual', polished: 'Polished', name1: 'Alex · roommate', body1: 'made way too many cookies 😭 want some?', name2: 'Daniel · classmate', body2: 'Hey — I ended up with extra cookies, want me to bring some tomorrow?', send: 'Send both' },
    'es-ES': { title: 'Dos mensajes', tone: 'Tono', casual: 'Informal', polished: 'Formal', name1: 'Alex · compañero de piso', body1: 'me salieron demasiadas galletas 😭 ¿quieres?', name2: 'Daniel · compañero', body2: 'Oye, me sobraron galletas, ¿te traigo mañana?', send: 'Enviar ambos' },
    'fr-FR': { title: 'Deux messages', tone: 'Ton', casual: 'Décontracté', polished: 'Soigné', name1: 'Alex · colocataire', body1: "j'ai fait beaucoup trop de cookies 😭 tu en veux ?", name2: 'Daniel · camarade', body2: "Salut, il me reste des cookies, je t'en apporte demain ?", send: 'Envoyer les deux' },
    'de-DE': { title: 'Zwei Nachrichten', tone: 'Ton', casual: 'Locker', polished: 'Formell', name1: 'Alex · Mitbewohner', body1: 'hab viel zu viele Kekse gebacken 😭 willst du welche?', name2: 'Daniel · Kommilitone', body2: 'Hey, ich hab noch Kekse übrig, bring ich dir morgen welche mit?', send: 'Beide senden' },
    'ja-JP': { title: '2件のメッセージ', tone: 'トーン', casual: 'カジュアル', polished: '丁寧', name1: 'アレックス・ルームメイト', body1: 'クッキー作りすぎた😭 いる？', name2: 'ダニエル・クラスメート', body2: 'クッキーが余ったので、明日持っていくね', send: '両方送信' },
    'ar-SA': { title: 'رسالتان', tone: 'النبرة', casual: 'ودّي', polished: 'رسمي', name1: 'أليكس · زميل السكن', body1: 'صنعت كمية كبيرة من الكوكيز 😭 تحب منها؟', name2: 'دانيال · زميل الدراسة', body2: 'مرحباً، تبقّى معي كوكيز، أحضر لك غداً؟', send: 'إرسال الرسالتين' },
  };
  const c = copy[locale];
  const targets: ContentGenerationRequestV1['targets'] = [
    { elementId: 'title', component: 'Heading', purpose: 'Screen title', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 60, format: 'plain-text' } }], fixed: { level: 2 } },
    { elementId: 'tone', component: 'Slider', purpose: 'Message tone control', fields: [
      { name: 'label', type: 'string', required: true, constraints: { minLength: 1, maxLength: 24, format: 'plain-text' } },
      { name: 'minLabel', type: 'string', required: false, constraints: { minLength: 1, maxLength: 16, format: 'plain-text' } },
      { name: 'maxLabel', type: 'string', required: false, constraints: { minLength: 1, maxLength: 16, format: 'plain-text' } },
    ], fixed: { min: 0, max: 4, step: 1, value: 1 } },
    { elementId: 'name-1', component: 'Label', purpose: 'First recipient', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 24, format: 'plain-text' } }], fixed: {} },
    { elementId: 'body-1', component: 'Text', purpose: 'Message to the first recipient', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 220, format: 'plain-text' } }], fixed: {} },
    { elementId: 'name-2', component: 'Label', purpose: 'Second recipient', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 24, format: 'plain-text' } }], fixed: {} },
    { elementId: 'body-2', component: 'Text', purpose: 'Message to the second recipient', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 220, format: 'plain-text' } }], fixed: {} },
    { elementId: 'send', component: 'Button', purpose: 'Send both messages', fields: [{ name: 'text', type: 'string', required: true, constraints: { minLength: 1, maxLength: 24, format: 'plain-text' } }], fixed: { variant: 'primary' } },
  ];
  return {
    request: req(requestId, locale, 'Write messages to share extra cookies', {}, targets),
    result: res(requestId, {
      title: { text: c.title },
      tone: { label: c.tone, minLabel: c.casual, maxLabel: c.polished },
      'name-1': { text: c.name1 },
      'body-1': { text: c.body1 },
      'name-2': { text: c.name2 },
      'body-2': { text: c.body2 },
      send: { text: c.send },
    }),
  };
};

export const SCENARIO_BUILDERS: Record<string, Builder> = {
  cookie_recipe: cookieRecipe,
  train_ticket: trainTicket,
  study_planner: studyPlanner,
  travel_rebooking: travelRebooking,
  comfort_settings: comfortSettings,
  share_message: shareMessage,
};
