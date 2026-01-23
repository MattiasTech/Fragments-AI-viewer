/**
 * Google Gemini API Client
 */

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
}

/**
 * Send a message to Google Gemini API
 */
export const sendGeminiMessage = async (
  apiKey: string,
  message: string,
  model: string = 'gemini-2.0-flash'
): Promise<string> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: message
                }
              ]
            }
          ]
        })
      });

      if (response.status === 429) {
        // Rate limit hit, wait and retry
        attempt++;
        const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
        console.warn(`Gemini API rate limited (429). Retrying in ${waitTime}ms... (Attempt ${attempt}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error?.message || `Gemini API error: ${response.status} ${response.statusText}`
        );
      }

      const data: GeminiResponse = await response.json();
      
      if (!data.candidates || data.candidates.length === 0) {
        throw new Error('No response from Gemini API');
      }

      return data.candidates[0].content.parts[0].text;
    } catch (error) {
      if (attempt === MAX_RETRIES - 1) throw error;
      // If network error, maybe also retry? For now let's stick to 429 handling or simple throw
      // But if we caught a non-429 error above, we threw.
      // If fetch failed (network), we are here.
      throw error; 
    }
  }
  throw new Error('Gemini API request failed after max retries');
};

/**
 * Test Gemini API connection
 */
export const testGeminiConnection = async (
  apiKey: string,
  model: string = 'gemini-2.0-flash-exp'
): Promise<boolean> => {
  try {
    await sendGeminiMessage(apiKey, 'Hello, respond with OK', model);
    return true;
  } catch {
    return false;
  }
};
