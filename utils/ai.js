// Discord mesajlarina AI cevabi uretmek icin Google Gemini API'sini kullanir (ucretsiz katman).
// API key almak icin: https://aistudio.google.com/apikey (kredi karti istemiyor)
// .env dosyana GEMINI_API_KEY=... seklinde eklemen gerekiyor.

const MODEL = 'gemini-3.5-flash';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_PROMPT =
  'Sen bir Discord sunucusunda yardimci olan, samimi, kisa ve Turkce cevap veren bir asistansin. ' +
  'Cevaplarini genellikle 1-4 cumleyi gecmeyecek sekilde, sohbet diline uygun ver. Gereksiz uzun aciklama yapma.';

async function askAI(userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY tanimli degil (.env dosyasina ekle).');
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`AI istegi basarisiz (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  return text || 'Bir cevap uretemedim.';
}

module.exports = { askAI };