// Seeds the Secondary subjects the first time the server starts after v1.11 (only when no secondary course exists yet,
// so an admin who deletes or renames one is never overridden). Topic lists are broad syllabus headings; admins can edit
// them, or use "✨ Topics" in Course Management to build them from uploaded questions.
const { SUBJECTS, subjectKey } = require('./secondary');

const TOPICS = {
  'SEC-ENG': ['Comprehension', 'Summary', 'Lexis and structure', 'Sentence types and clauses', 'Concord (subject-verb agreement)', 'Figures of speech', 'Idioms and phrasal verbs', 'Synonyms and antonyms', 'Punctuation and spelling', 'Oral English: vowels and consonants', 'Oral English: stress and intonation'],
  'SEC-MTH': ['Number and numeration', 'Indices, logarithms and surds', 'Sets', 'Algebra', 'Variation', 'Geometry and mensuration', 'Trigonometry', 'Coordinate geometry', 'Statistics', 'Probability', 'Vectors and matrices', 'Differentiation and integration'],
  'SEC-PHY': ['Measurements and units', 'Motion', 'Work, energy and power', 'Simple machines', 'Heat and thermodynamics', 'Waves and sound', 'Light and optics', 'Current electricity', 'Magnetism and electromagnetism', 'Gravitational and electric fields', 'Atomic and nuclear physics'],
  'SEC-CHM': ['Atomic structure and bonding', 'Periodic table', 'Mole concept and stoichiometry', 'Acids, bases and salts', 'Oxidation and reduction', 'Electrolysis', 'Gas laws', 'Energy changes and rates of reaction', 'Chemical equilibrium', 'Organic chemistry', 'Metals and non-metals', 'Water, air and the environment'],
  'SEC-BIO': ['Cell biology', 'Classification of living things', 'Nutrition and digestion', 'Respiration and transport', 'Excretion and homeostasis', 'Nervous system and coordination', 'Reproduction', 'Genetics and evolution', 'Ecology', 'Plant biology'],
  'SEC-ECO': ['Basic concepts in economics', 'Demand and supply', 'Theory of production and costs', 'Market structures', 'National income', 'Money and banking', 'Public finance', 'International trade', 'Population', 'Agriculture and industry in Nigeria'],
  'SEC-GOV': ['Basic concepts in government', 'Constitutions', 'Arms of government', 'Federalism', 'Political parties and elections', 'Pre-colonial political systems', 'Colonial rule and nationalism', 'Public administration', 'International organisations (UN, AU, ECOWAS)'],
  'SEC-LIT': ['Drama', 'Prose', 'Poetry', 'Literary terms', 'Appreciation of unseen passages'],
};

function seedDocs() {
  return SUBJECTS.map(s => ({
    courseCode: s.code, key: subjectKey(s.code), courseTitle: s.title,
    department: 'SECONDARY', level: 'SS', color: s.color, icon: s.icon,
    topics: TOPICS[s.code] || [], track: 'secondary',
  }));
}

// OFF by default: a deploy creates no secondary data on its own. Set SEED_SECONDARY_SUBJECTS=true only if you want these
// starter subject shells (no questions) created once. Otherwise add subjects yourself in Admin > Course Management
// with "Where does it appear?" set to Secondary.
async function bootstrapSecondaryCourses(Course, env = process.env) {
  try {
    if (String(env.SEED_SECONDARY_SUBJECTS || '').toLowerCase() !== 'true') return 0;
    if (await Course.exists({ track: 'secondary' })) return 0;
    const docs = seedDocs();
    await Course.insertMany(docs, { ordered: false });
    console.log(`Secondary bootstrap: seeded ${docs.length} JAMB / WAEC / NECO subjects.`);
    return docs.length;
  } catch (e) { console.error('Secondary bootstrap failed:', e.message); return 0; }
}

module.exports = { seedDocs, bootstrapSecondaryCourses, TOPICS };
