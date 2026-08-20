import { ClipboardEvent, DragEvent, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeftRight, ArrowUp, ClipboardPaste, Image, Images, LoaderCircle, ScanText, ShieldCheck, X } from 'lucide-react';
import { assessOcrQuality, mergeOcrTexts, recognizeChatScreenshots, swapSpeakerLabels } from './ocr';

type ScreenshotItem = {
  id: string;
  file: File;
  url: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  progress: number;
  statusLabel: string;
  extractedText: string;
  messageCount: number;
};

type ScreenshotInputProps = {
  text: string;
  onTextChange: (text: string) => void;
  onAnalyze: (text: string) => Promise<void>;
  onError: (message: string) => void;
  disabled?: boolean;
};

const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function makeItem(file: File): ScreenshotItem {
  return {
    id: crypto.randomUUID(),
    file,
    url: URL.createObjectURL(file),
    status: 'queued',
    progress: 0,
    statusLabel: '等待识别',
    extractedText: '',
    messageCount: 0,
  };
}

export default function ScreenshotInput({ text, onTextChange, onAnalyze, onError, disabled }: ScreenshotInputProps) {
  const [items, setItems] = useState<ScreenshotItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [leftIsThem, setLeftIsThem] = useState(true);
  const [showReview, setShowReview] = useState(false);
  const [manuallyEdited, setManuallyEdited] = useState(false);
  const itemsRef = useRef(items);

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => () => itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url)), []);

  const addFiles = (fileList: FileList | File[]) => {
    if (isRecognizing) return onError('请等待当前截图识别完成。');
    const files = Array.from(fileList);
    const invalidType = files.find((file) => !SUPPORTED_TYPES.has(file.type));
    const oversized = files.find((file) => file.size > MAX_IMAGE_BYTES);
    if (invalidType) return onError(`暂不支持 ${invalidType.name}，请使用 PNG、JPG 或 WebP。`);
    if (oversized) return onError(`${oversized.name} 超过 12 MB，请压缩后重试。`);
    if (items.length + files.length > MAX_IMAGES) return onError(`一次最多识别 ${MAX_IMAGES} 张截图。`);
    setItems((current) => [...current, ...files.map(makeItem)]);
    onError('');
  };

  const removeItem = (id: string) => {
    setItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.url);
      const next = current.filter((item) => item.id !== id);
      const recognized = next.map((item) => item.extractedText).filter(Boolean);
      if (recognized.length) onTextChange(mergeOcrTexts(recognized));
      return next;
    });
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    setItems((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      const recognized = next.map((item) => item.extractedText).filter(Boolean);
      if (recognized.length) onTextChange(mergeOcrTexts(recognized));
      return next;
    });
  };

  const recognizeAndAnalyze = async () => {
    if (!items.length || isRecognizing) return;
    if (manuallyEdited && text.trim()) {
      const editedQuality = assessOcrQuality(text.replaceAll('【请校对】', ''));
      if (editedQuality.usableMessages < 2) return onError('至少需要两条有效聊天消息。');
      await onAnalyze(editedQuality.usableText);
      return;
    }
    setIsRecognizing(true);
    setShowReview(false);
    onError('');
    setItems((current) => current.map((item) => ({ ...item, status: 'queued', progress: 0, statusLabel: '等待识别', extractedText: '', messageCount: 0 })));
    try {
      const { text: recognizedText } = await recognizeChatScreenshots(items.map((item) => item.file), {
        leftIsThem,
        onProgress({ imageIndex, progress, status }) {
          setItems((current) => current.map((item, index) => index === imageIndex ? { ...item, status: 'processing', progress, statusLabel: status } : item));
        },
        onImageResult(imageIndex, result) {
          setItems((current) => current.map((item, index) => index === imageIndex ? {
            ...item,
            status: result.error ? 'error' : 'done',
            progress: result.error ? 0 : 100,
            statusLabel: result.error ? '读取失败' : `读取到 ${result.messageCount} 条`,
            extractedText: result.text,
            messageCount: result.messageCount,
          } : item));
        },
      });
      const quality = assessOcrQuality(recognizedText);
      // Only expose the vetted transcript to the rest of the app. This keeps
      // low-quality OCR from becoming analysis input or report evidence.
      onTextChange(quality.usableText);
      if (!quality.acceptable) {
        setItems((current) => current.map((item) => item.status === 'done' ? { ...item, status: 'error', statusLabel: '质量不足，请重试' } : item));
        setShowReview(false);
        onError('这张图无法可靠读取。请上传手机里的原始聊天截图，不要上传包含网页、相册边框或多张拼图的画面。');
      } else {
        await onAnalyze(quality.usableText);
      }
    } catch (cause) {
      onError(cause instanceof Error ? `OCR 启动失败：${cause.message}` : 'OCR 启动失败，请检查网络后重试。');
    } finally {
      setIsRecognizing(false);
    }
  };

  const pasteFromClipboard = async () => {
    if (!navigator.clipboard?.read) {
      onError('当前浏览器不支持读取剪贴板，请点击截图区域后按 Ctrl+V。');
      return;
    }
    try {
      const clipboardItems = await navigator.clipboard.read();
      const files: File[] = [];
      for (const clipboardItem of clipboardItems) {
        const type = clipboardItem.types.find((candidate) => SUPPORTED_TYPES.has(candidate));
        if (!type) continue;
        const blob = await clipboardItem.getType(type);
        files.push(new File([blob], `clipboard-${Date.now()}.${type.split('/')[1]}`, { type }));
      }
      if (!files.length) onError('剪贴板里没有可识别的 PNG、JPG 或 WebP 图片。');
      else addFiles(files);
    } catch {
      onError('无法读取剪贴板。请允许浏览器访问，或直接按 Ctrl+V。');
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (!disabled && !isRecognizing) addFiles(event.dataTransfer.files);
  };

  const swapSpeakers = () => {
    setLeftIsThem((value) => !value);
    onTextChange(swapSpeakerLabels(text));
    setItems((current) => current.map((item) => ({ ...item, extractedText: swapSpeakerLabels(item.extractedText) })));
  };

  const completed = items.filter((item) => item.status === 'done').length;
  const overallProgress = items.length ? Math.round(items.reduce((sum, item) => sum + item.progress, 0) / items.length) : 0;

  return <div className="screenshot-input">
    <div
      className={`screenshot-dropzone${isDragging ? ' screenshot-dropzone--active' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false); }}
      onDrop={handleDrop}
      onPaste={handlePaste}
      tabIndex={0}
    >
      <span className="dropzone-icon"><Images size={22} /></span>
      <div><b>拖入或粘贴聊天截图</b><span>支持多张 PNG、JPG、WebP，单张不超过 12 MB</span></div>
      <div className="dropzone-actions">
        <label className="upload-button"><Image size={15} /> 选择截图<input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={disabled || isRecognizing} onChange={(event) => event.target.files && addFiles(event.target.files)} /></label>
        <button type="button" className="upload-button" disabled={disabled || isRecognizing} onClick={pasteFromClipboard}><ClipboardPaste size={15} /> 粘贴截图</button>
      </div>
    </div>

    {items.length > 0 && <div className="screenshot-queue">
      <div className="screenshot-queue__head"><span>{items.length} 张截图 · 按聊天先后排序</span><span>{isRecognizing ? `${overallProgress}%` : completed ? `${completed} 张已读取` : items.some((item) => item.status === 'error') ? '读取失败' : '准备就绪'}</span></div>
      {items.map((item, index) => <div className="screenshot-row" key={item.id}>
        <img src={item.url} alt={`聊天截图 ${index + 1}`} />
        <span className="screenshot-order">{String(index + 1).padStart(2, '0')}</span>
        <div className="screenshot-meta"><b>{item.file.name}</b><span>{item.statusLabel}</span>{item.status === 'processing' && <i><span style={{ width: `${item.progress}%` }} /></i>}</div>
        <div className="screenshot-tools">
          <button type="button" title="上移" disabled={index === 0 || isRecognizing} onClick={() => moveItem(index, -1)}><ArrowUp size={14} /></button>
          <button type="button" title="下移" disabled={index === items.length - 1 || isRecognizing} onClick={() => moveItem(index, 1)}><ArrowDown size={14} /></button>
          <button type="button" title="移除" disabled={isRecognizing} onClick={() => removeItem(item.id)}><X size={14} /></button>
        </div>
      </div>)}
      <div className="ocr-action-row"><div><b>默认：左侧是她，右侧是我</b><span>点击后自动读取截图并进入 Agent 分析，图片不会上传。</span></div><button type="button" className="button button--ghost button--small" disabled={isRecognizing || disabled} onClick={swapSpeakers}><ArrowLeftRight size={15} /> {leftIsThem ? '交换左右说话人' : '恢复默认说话人'}</button><button type="button" className="button button--primary button--small" disabled={isRecognizing || disabled} onClick={recognizeAndAnalyze}>{isRecognizing ? <><LoaderCircle className="spin" size={15} /> 正在读取 {overallProgress}%</> : disabled ? <><LoaderCircle className="spin" size={15} /> Agent 分析中</> : <><ScanText size={15} /> 开始分析</>}</button></div>
    </div>}

    {text.trim() && <details className="ocr-review ocr-review--optional" open={showReview} onToggle={(event) => setShowReview(event.currentTarget.open)}>
      <summary className="ocr-review__head"><div><ShieldCheck size={15} /><span><b>{showReview ? '识别详情' : '查看识别详情'}</b>{showReview ? ' · 修正后再次点击开始分析' : ''}</span></div><span>{text.split('\n').filter(Boolean).length} 行</span></summary>
      <textarea value={text} onChange={(event) => { setManuallyEdited(true); onTextChange(event.target.value); }} aria-label="可编辑的截图识别结果" />
    </details>}
  </div>;
}
