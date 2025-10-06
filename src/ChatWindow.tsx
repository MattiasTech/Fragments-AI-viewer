import React, { useState, useRef, useCallback, useEffect } from 'react';
import Draggable from 'react-draggable';
import { Paper, IconButton, TextField, Button, Typography, Box, CircularProgress } from '@mui/material';
import { Chat as ChatIcon, Minimize, OpenInFull, Close as CloseIcon } from '@mui/icons-material';
import { GoogleGenerativeAI, Content } from '@google/generative-ai';

// --- Configuration ---
const GEMINI_MODEL = 'gemini-2.5-flash';
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? '';

export interface SelectionCommand {
  action: 'select' | 'clear';
  filter?: Record<string, any>;
  mode?: 'highlight' | 'isolate' | 'focus';
}

const selectionGuidelines = `You can control the BIM viewer selection with a structured command.\nWhen the user explicitly asks you to select, highlight, filter, show, hide, isolate, or focus objects, append a single line at the end of your reply in this exact format:\nSELECTION: {"action":"select","filter":{...},"mode":"highlight"}\nUse "action":"clear" when the user wants to clear selections.\nChoose keys inside filter that match the model data (e.g. category, type, system, name, globalId, guid).\nOnly emit the SELECTION line when a selection action is required. Otherwise omit it entirely.`;

const SELECTION_MARKER = 'SELECTION:';

const extractJsonFromText = (text: string): string | null => {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let prev = '';
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === '"' && prev !== '\\') inString = false;
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
    prev = char;
  }
  return null;
};

const parseSelectionFromResponse = (raw: string): { cleaned: string; command: SelectionCommand | null } => {
  if (!raw) return { cleaned: raw, command: null };
  const index = raw.toUpperCase().lastIndexOf(SELECTION_MARKER);
  if (index === -1) return { cleaned: raw, command: null };
  const payload = raw.slice(index + SELECTION_MARKER.length).trim();
  const withoutFence = payload.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const jsonText = extractJsonFromText(withoutFence);
  if (!jsonText) return { cleaned: raw, command: null };
  try {
    const parsed = JSON.parse(jsonText) as SelectionCommand;
    if (!parsed || typeof parsed.action !== 'string') {
      return { cleaned: raw, command: null };
    }
    const cleaned = raw.slice(0, index).trimEnd();
    return { cleaned: cleaned || raw, command: parsed };
  } catch {
    return { cleaned: raw, command: null };
  }
};

const createModel = () => {
  const key = API_KEY.trim();
  if (!key) {
    throw new Error('MISSING_GEMINI_KEY');
  }
  const genAI = new GoogleGenerativeAI(key);
  return genAI.getGenerativeModel({ model: GEMINI_MODEL });
};

interface Message {
  role: 'user' | 'model' | 'system';
  text: string;
}

interface ChatWindowProps {
  getModelDataForAI: () => Promise<string>;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  expandSignal: number;
  onRequestSelection?: (command: SelectionCommand) => void;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ getModelDataForAI, isOpen, onOpen, onClose, expandSignal, onRequestSelection }) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', text: 'Hello! I am your BIM assistant. Ask me anything about the loaded models.' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const nodeRef = useRef(null);
  const [size, setSize] = useState({ width: 400, height: 500 });
  const resizeOriginRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const resizingRef = useRef(false);

  const onPointerMove = useCallback((event: PointerEvent) => {
    if (!resizingRef.current) return;
    const origin = resizeOriginRef.current;
    if (!origin) return;
    const deltaX = event.clientX - origin.startX;
    const deltaY = event.clientY - origin.startY;
    const minWidth = 320;
    const minHeight = 260;
    setSize(prev => {
      const nextWidth = Math.max(minWidth, origin.width + deltaX);
      const nextHeight = Math.max(minHeight, origin.height + deltaY);
      if (nextWidth === prev.width && nextHeight === prev.height) return prev;
      return { width: Math.round(nextWidth), height: Math.round(nextHeight) };
    });
  }, []);

  const stopResize = useCallback(() => {
    if (!resizingRef.current) return;
    resizingRef.current = false;
    resizeOriginRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopResize);
  }, [onPointerMove]);

  const handleResizeStart = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const node = nodeRef.current as HTMLElement | null;
    if (!node) return;
    resizingRef.current = true;
    resizeOriginRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      width: node.offsetWidth,
      height: node.offsetHeight,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResize);
  }, [onPointerMove, stopResize]);

  useEffect(() => {
    return () => {
      stopResize();
    };
  }, [stopResize]);

  useEffect(() => {
    if (!isOpen) return;
    setIsMinimized(false);
  }, [expandSignal, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setIsMinimized(false);
    }
  }, [isOpen]);

  const handleSend = async () => {
    const question = input.trim();
    if (!question) return;

    const userMessage: Message = { role: 'user', text: question };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');

    if (!API_KEY.trim()) {
      setMessages(prev => [...prev, { role: 'system', text: 'Gemini API key is missing. Add VITE_GEMINI_API_KEY to your Vite environment (e.g. .env.local) before chatting.' }]);
      return;
    }

    setIsLoading(true);

    try {
      const model = createModel();
      // 1. Get contextual data from the main app
      const modelContext = await getModelDataForAI();

      // 2. Construct the prompt
      const history: Content[] = updatedMessages.map(msg => ({
        role: msg.role === 'system' ? 'model' : msg.role,
        parts: [{ text: msg.text }]
      }));
      
      const contents: Content[] = [
        ...history,
        {
          role: 'user',
          parts: [{
            text: `You are a helpful BIM assistant who can describe models and help users explore geometry.
Follow these instructions carefully:
- Always provide clear, concise answers grounded in the supplied model data.
- ${selectionGuidelines}
Based on the following model data, please answer the user's question.
---
MODEL DATA:
${modelContext}
---
USER QUESTION:
${question}`
          }]
        }
      ];

      // 3. Call Gemini API
      const result = await model.generateContent({ contents });
      const response = result.response;
      const rawText = response.text();
      const { cleaned, command } = parseSelectionFromResponse(rawText);

      const modelMessage: Message = { role: 'model', text: cleaned };
      setMessages(prev => [...prev, modelMessage]);

      if (command && typeof onRequestSelection === 'function') {
        try {
          onRequestSelection(command);
        } catch (err) {
          console.error('Failed to handle AI selection command', err);
        }
      }

    } catch (error) {
      console.error('Error calling Gemini API:', error);
      let hint = 'Sorry, I encountered an error while talking to Gemini.';
      const asAny = error as any;
      const message = asAny?.message ?? (error instanceof Error ? error.message : '');
      const status = asAny?.status ?? asAny?.code ?? '';
      const lowerMessage = typeof message === 'string' ? message.toLowerCase() : '';

      if (message === 'MISSING_GEMINI_KEY') {
        hint = 'Gemini API key is missing. Set VITE_GEMINI_API_KEY and reload the app.';
      } else if (lowerMessage.includes('401') || status === 401) {
        hint = 'Gemini rejected the API key (401). Confirm the key is valid and has access to the requested model.';
      } else if (lowerMessage.includes('403') || status === 403) {
        hint = 'Gemini returned 403. Ensure the project has access to this model and that billing is enabled.';
      } else if (lowerMessage.includes('404') || status === 404) {
        hint = 'Gemini returned 404 for this model. Verify the model name and availability in your project (use ListModels in Google AI Studio or switch to a supported variant).';
      } else if (lowerMessage.includes('429') || status === 429) {
        const retry = typeof asAny?.error?.error?.details?.[2]?.retryDelay === 'string'
          ? asAny.error.error.details[2].retryDelay
          : asAny?.error?.error?.details?.find?.((detail: any) => typeof detail?.retryDelay === 'string')?.retryDelay;
        const waitText = retry ? ` Please wait ~${retry.replace(/s$/, ' seconds')} before retrying.` : '';
        hint = `Gemini quota exceeded (429). You've hit the free tier input-token limit. ${waitText} Consider reducing prompt size, waiting a minute, or upgrading quota.`;
      } else if (lowerMessage.includes('quota') || lowerMessage.includes('limit')) {
        hint = 'Gemini reported a quota issue. Check your plan, reduce prompt size, or wait before retrying.';
      }

      if (typeof asAny?.error === 'object') {
        const retryInfo = asAny.error?.error?.details?.find?.((detail: any) => typeof detail?.retryDelay === 'string');
        if (!hint.includes('quota') && retryInfo?.retryDelay) {
          hint += ` Gemini suggests waiting ~${retryInfo.retryDelay.replace(/s$/, ' seconds')} before retrying.`;
        }
      }

      const errorMessage: Message = { role: 'system', text: hint };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <Paper elevation={6} sx={{ position: 'fixed', bottom: 20, right: 20, zIndex: 2100 }}>
        <IconButton onClick={onOpen}>
          <ChatIcon />
        </IconButton>
      </Paper>
    );
  }

  return (
    <Draggable nodeRef={nodeRef} handle=".chat-header" bounds="parent">
      <Paper 
        ref={nodeRef} 
        elevation={8} 
        sx={{ 
          position: 'fixed', 
          bottom: 40, 
          right: 40, 
          width: size.width,
          height: isMinimized ? 'auto' : size.height,
          minWidth: 320,
          maxWidth: '90vw',
          minHeight: isMinimized ? 'auto' : 260,
          maxHeight: '85vh',
          zIndex: 2000,
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          overflow: 'hidden'
        }}
      >
        <Box 
          className="chat-header"
          sx={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            padding: '4px 8px', 
            backgroundColor: 'primary.main', 
            color: 'white',
            cursor: 'move'
          }}
        >
          <Typography variant="subtitle1">BIM AI Assistant</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <IconButton size="small" onClick={() => setIsMinimized(!isMinimized)} color="inherit">
              {isMinimized ? <OpenInFull /> : <Minimize />}
            </IconButton>
            <IconButton size="small" onClick={() => { setIsMinimized(false); onClose(); }} color="inherit">
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>

        {!isMinimized && (
          <>
            <Box sx={{ flex: 1, overflowY: 'auto', padding: 2, minHeight: 0 }}>
              {messages.map((msg, index) => (
                <Box key={index} sx={{ marginBottom: 1, textAlign: msg.role === 'user' ? 'right' : 'left' }}>
                  <Paper elevation={1} sx={{ 
                    padding: 1, 
                    display: 'inline-block',
                    backgroundColor: msg.role === 'user' ? 'primary.light' : (msg.role === 'system' ? 'grey.200' : 'white')
                  }}>
                    <Typography variant="body2">
                      <strong>{msg.role === 'model' ? 'AI' : (msg.role === 'system' ? 'System' : 'You')}:</strong> {msg.text}
                    </Typography>
                  </Paper>
                </Box>
              ))}
              {isLoading && <CircularProgress size={24} sx={{ display: 'block', margin: '10px auto' }} />}
            </Box>
            <Box sx={{ padding: 1, borderTop: '1px solid #ddd', display: 'flex' }}>
              <TextField
                fullWidth
                variant="outlined"
                size="small"
                placeholder="Ask about the model..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && !isLoading && handleSend()}
                disabled={isLoading}
              />
              <Button variant="contained" onClick={handleSend} disabled={isLoading} sx={{ marginLeft: 1 }}>
                Send
              </Button>
            </Box>
            <Box
              onPointerDown={handleResizeStart}
              sx={{
                position: 'absolute',
                bottom: 6,
                right: 6,
                width: 16,
                height: 16,
                cursor: 'nwse-resize',
                borderRight: '2px solid',
                borderBottom: '2px solid',
                borderColor: 'divider',
                opacity: 0.6,
                '&:hover': { opacity: 1 }
              }}
            />
          </>
        )}
      </Paper>
    </Draggable>
  );
};

export default ChatWindow;
