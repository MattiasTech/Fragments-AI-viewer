/**
 * OpenAI API Client
 */

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/**
 * Send a message to OpenAI API
 */
export const sendOpenAIMessage = async (
  apiKey: string,
  message: string,
  model: string = 'gpt-4o-mini'
): Promise<string> => {
  const url = 'https://api.openai.com/v1/chat/completions';
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: message
        }
      ]
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error?.message || `OpenAI API error: ${response.status} ${response.statusText}`
    );
  }

  const data: OpenAIResponse = await response.json();
  
  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from OpenAI API');
  }

  return data.choices[0].message.content;
};

/**
 * Test OpenAI API connection
 */
export const testOpenAIConnection = async (
  apiKey: string,
  model: string = 'gpt-4o-mini'
): Promise<boolean> => {
  try {
    await sendOpenAIMessage(apiKey, 'Hello, respond with OK', model);
    return true;
  } catch {
    return false;
  }
};
