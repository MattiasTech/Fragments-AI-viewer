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
  model: string = 'gemini-2.5-flash'
): Promise<string> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
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
