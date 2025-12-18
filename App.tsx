
import React, { useState, useEffect } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { 
  Document, 
  Packer, 
  Paragraph, 
  TextRun, 
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  HeadingLevel, 
  AlignmentType,
  BorderStyle,
  VerticalAlign,
  PageOrientation,
  TableLayoutType
} from 'docx';
import mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist';
import { NLS_3456_FRAMEWORK } from './constants';
import { SchoolLevel } from './types';

// Setup PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.mjs`;

const A4_WIDTH = 11906;
const A4_HEIGHT = 16838;
const MARGIN_TOP = 1134;
const MARGIN_BOTTOM = 1134;
const MARGIN_LEFT = 1701;
const MARGIN_RIGHT = 850;

const DEFAULT_SYSTEM_INSTRUCTION = `Bạn là chuyên gia thẩm định sư phạm EdTech cao cấp, am hiểu sâu sắc Chương trình GDPT 2018 và khung Năng lực số (NLS) 3456/BGDĐT.

NHIỆM VỤ CỦA BẠN:
1. PHÂN LOẠI CẤP HỌC: Dựa vào nội dung giáo án (khối lớp, độ phức tạp kiến thức, mục tiêu), hãy xác định giáo án thuộc cấp "Tiểu học" hay "THCS".
2. LỌC CHỈ BÁO NLS THEO CẤP HỌC: 
   - Nếu là "Tiểu học": Chỉ được sử dụng các mã chỉ báo có mức "L6-L7".
   - Nếu là "THCS": Chỉ được sử dụng các mã chỉ báo có mức "L8-L9".
3. PHÂN TÍCH TIẾN TRÌNH: Chia mục "Tiến trình dạy học" thành các hoạt động.
4. ĐỀ XUẤT NLS CÁ THỂ HÓA: Với mỗi hoạt động, viết lại mô tả chỉ báo NLS sao cho SÁT VỚI ĐƠN VỊ KIẾN THỨC và ĐẶC TRƯNG BỘ MÔN.
   - Ví dụ môn Toán: Thay vì nói "Tìm kiếm dữ liệu", hãy nói "Tìm kiếm và lọc các số liệu thống kê về dân số trên internet để phục vụ bài học biểu đồ".
5. ĐẢM BẢO TÍNH SƯ PHẠM: Đề xuất phải thực tế, phù hợp trình độ học sinh và hỗ trợ đạt được mục tiêu bài học.

QUY TRÌNH HOÀN THIỆN (QUAN TRỌNG):
Khi hoàn thiện văn bản:
1. GIỮ NGUYÊN 100% văn bản gốc.
2. TẠM BIẾN ĐỔI MỤC TIÊU: Tại phần "I. Mục tiêu -> 2. Năng lực", thêm dòng: "[NLS: - Năng lực số: {Mô tả NLS đã ngữ cảnh hóa cho toàn bài} - Mã: {Mã}]".
3. CHÈN VÀO TIẾN TRÌNH: Tại các anchor text, chèn: "[NLS: {Mô tả NLS ngắn gọn sát hoạt động} - Mã: {Mã}]".

DỮ LIỆU NĂNG LỰC SỐ 3456 (GỒM CẤU TRÚC LEVEL):
${JSON.stringify(NLS_3456_FRAMEWORK)}`;

interface ImageResource {
  id: string;
  base64: string;
  contentType: string;
}

interface FileData {
  name: string;
  content: string;
  images?: ImageResource[];
}

interface NLSSuggestion {
  code: string;
  criteria: string;
  reason: string;
  accepted: boolean;
}

interface SegmentAnalysis {
  id: string;
  activityName: string;
  originalText: string;
  suggestions: NLSSuggestion[];
}

const App: React.FC = () => {
  const [files, setFiles] = useState<{
    lessonPlan: FileData | null;
  }>({
    lessonPlan: null,
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState("");
  const [analysisResult, setAnalysisResult] = useState<SegmentAnalysis[]>([]);
  const [detectedLevel, setDetectedLevel] = useState<SchoolLevel | null>(null);
  const [subjectInfo, setSubjectInfo] = useState<string>("");
  const [resultPlan, setResultPlan] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'review' | 'preview'>('upload');
  const [systemInstruction, setSystemInstruction] = useState(DEFAULT_SYSTEM_INSTRUCTION);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'docx') {
        const { text, images } = await extractContentWithImages(file);
        setFiles({ lessonPlan: { name: file.name, content: text, images } });
      } else if (ext === 'pdf') {
        const text = await extractPdfText(file);
        setFiles({ lessonPlan: { name: file.name, content: text } });
      }
      setAnalysisResult([]);
      setDetectedLevel(null);
      setResultPlan(null);
      setActiveTab('upload');
    } catch (err) {
      alert("Lỗi đọc file");
    }
  };

  const startAnalysis = async () => {
    if (!files.lessonPlan) return;
    setIsProcessing(true);
    setProcessingStep("AI đang nghiên cứu đơn vị kiến thức và phân loại cấp học...");
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Hãy phân loại cấp học (Tiểu học hoặc THCS) và phân tích mục "Tiến trình dạy học" để đề xuất tích hợp NLS 3456 phù hợp với cấp học đó. 
Yêu cầu: 
- Nếu là Tiểu học, chỉ lấy mã L6-L7. 
- Nếu là THCS, chỉ lấy mã L8-L9.
- Viết lại mô tả criteria (chỉ báo) sao cho gắn liền với kiến thức của bài này:
${files.lessonPlan.content.substring(0, 15000)}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detectedLevel: { type: Type.STRING, description: "'Tiểu học' hoặc 'THCS'" },
              subjectInfo: { type: Type.STRING, description: "Tên môn và chủ đề kiến thức nhận diện được" },
              segments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    activityName: { type: Type.STRING },
                    originalText: { type: Type.STRING, description: "Trích dẫn 10-15 từ đầu tiên của đoạn văn bản để làm mốc" },
                    suggestions: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          code: { type: Type.STRING },
                          criteria: { type: Type.STRING, description: "Mô tả chỉ báo đã được viết lại sát với đơn vị kiến thức" },
                          reason: { type: Type.STRING, description: "Giải thích tại sao chỉ báo này hỗ trợ tốt cho kiến thức/bộ môn này" }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      });

      const data = JSON.parse(response.text);
      setDetectedLevel(data.detectedLevel as SchoolLevel);
      setSubjectInfo(data.subjectInfo);
      const formatted = data.segments.map((seg: any) => ({
        ...seg,
        suggestions: seg.suggestions.map((s: any) => ({ ...s, accepted: true }))
      }));
      setAnalysisResult(formatted);
      setActiveTab('review');
    } catch (err: any) {
      alert("Lỗi phân tích: " + err.message);
    } finally {
      setIsProcessing(false);
      setProcessingStep("");
    }
  };

  const finalizeDocument = async () => {
    setIsProcessing(true);
    setProcessingStep("Đang chuẩn hóa mô tả NLS theo đặc trưng bộ môn...");
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const approvedData = analysisResult.filter(seg => seg.suggestions.some(s => s.accepted));
      const allApprovedNLS = approvedData.flatMap(d => d.suggestions.filter(s => s.accepted));
      
      const uniqueNLS = Array.from(new Set(allApprovedNLS.map(s => s.code)))
        .map(code => allApprovedNLS.find(s => s.code === code));

      const approvedInstruction = `Bạn là trợ lý soạn thảo chuyên nghiệp. Hãy lấy văn bản giáo án gốc và thực hiện:
1. TẠI PHẦN I. MỤC TIÊU: Tìm tiểu mục "2. Năng lực". Ở CUỐI tiểu mục này, hãy thêm dòng mới: "[NLS: - Năng lực số: ${uniqueNLS.map(s => `${s?.criteria} (Mã: ${s?.code})`).join('; ')}]". 
   Lưu ý: Mô tả NLS này phải là mô tả đã được AI cá thể hóa theo kiến thức của bài học. Cấp học đã xác định là: ${detectedLevel}.
2. TẠI TIẾN TRÌNH DẠY HỌC: Tại các vị trí mốc (anchor text), hãy chèn nội dung NLS tương ứng, định dạng là [NLS: {Mô tả cá thể hóa} - Mã: {Mã}].
3. GIỮ NGUYÊN 100% CÁC NỘI DUNG KHÁC. Đảm bảo cấu trúc tiêu đề được tôn trọng.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `Văn bản gốc: ${files.lessonPlan?.content.substring(0, 20000)}`,
        config: {
          systemInstruction: approvedInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              fullContent: { type: Type.STRING },
              title: { type: Type.STRING }
            }
          }
        }
      });

      setResultPlan(JSON.parse(response.text));
      setActiveTab('preview');
    } catch (err: any) {
      alert("Lỗi hoàn thiện: " + err.message);
    } finally {
      setIsProcessing(false);
      setProcessingStep("");
    }
  };

  const toggleSuggestion = (segId: string, code: string) => {
    setAnalysisResult(prev => prev.map(seg => {
      if (seg.id !== segId) return seg;
      return {
        ...seg,
        suggestions: seg.suggestions.map(s => s.code === code ? { ...s, accepted: !s.accepted } : s)
      };
    }));
  };

  const downloadDocx = async () => {
    if (!resultPlan) return;
    const docChildren: any[] = [];
    const lines = resultPlan.fullContent.split('\n');
    let inTable = false, tableRows: TableRow[] = [];

    lines.forEach((line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      
      if (trimmed === "[START_TABLE]") { inTable = true; tableRows = []; return; }
      if (trimmed === "[END_TABLE]") {
        inTable = false;
        if (tableRows.length) docChildren.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          layout: TableLayoutType.FIXED,
          rows: tableRows,
          borders: {
            top: { style: BorderStyle.SINGLE, size: 2 },
            bottom: { style: BorderStyle.SINGLE, size: 2 },
            left: { style: BorderStyle.SINGLE, size: 2 },
            right: { style: BorderStyle.SINGLE, size: 2 },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
            insideVertical: { style: BorderStyle.SINGLE, size: 1 },
          }
        }));
        return;
      }

      if (inTable) {
        const cells = trimmed.split("[COL_SEP]").map((col, idx) => new TableCell({
          children: col.split("[BR]").map(cl => new Paragraph({ 
            children: createTextRuns(cl.trim()),
            spacing: { before: 120, after: 120, line: 360 },
            alignment: AlignmentType.BOTH
          })),
          width: { size: idx === 0 ? 35 : 65, type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.TOP,
          margins: { top: 100, bottom: 100, left: 100, right: 100 }
        }));
        tableRows.push(new TableRow({ children: cells, cantSplit: true }));
      } else {
        const isMainHeading = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)\./i.test(trimmed);
        const isSubHeading = /^\d+\./.test(trimmed);
        const isAlphaHeading = /^[a-z]\)/i.test(trimmed) || /^[a-z]\./i.test(trimmed);
        const isTitle = trimmed.toUpperCase().includes("KẾ HOẠCH BÀI DẠY") || trimmed.toUpperCase().includes("BÀI :");
        
        docChildren.push(new Paragraph({
          children: createTextRuns(trimmed, isMainHeading || isSubHeading || isAlphaHeading || isTitle),
          alignment: isTitle ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { 
            before: isMainHeading ? 400 : (isSubHeading ? 240 : 120), 
            after: 120, 
            line: 360 
          },
          indent: !isMainHeading && !isSubHeading && !isTitle ? { firstLine: 700 } : undefined
        }));
      }
    });

    const doc = new Document({
      sections: [{
        properties: {
          page: { size: { width: A4_WIDTH, height: A4_HEIGHT }, margin: { top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: MARGIN_LEFT, right: MARGIN_RIGHT }, orientation: PageOrientation.PORTRAIT },
        },
        children: docChildren
      }]
    });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${resultPlan.title || 'GiaoAn_NLS'}.docx`;
    a.click();
  };

  const createTextRuns = (text: string, isHeader: boolean = false): any[] => {
    const runs: any[] = [];
    const imageMarkerRegex = /\[\[IMAGE_RES_(\d+)\]\]/g;
    let lastIdx = 0, match;

    while ((match = imageMarkerRegex.exec(text)) !== null) {
      const before = text.substring(lastIdx, match.index);
      if (before) runs.push(...highlightTextWord(before, isHeader));
      const imgRes = files.lessonPlan?.images?.find(img => img.id === `[[IMAGE_RES_${match![1]}]]`);
      if (imgRes) runs.push(new ImageRun({ data: base64ToUint8Array(imgRes.base64), transformation: { width: 450, height: 320 } }));
      lastIdx = imageMarkerRegex.lastIndex;
    }
    const after = text.substring(lastIdx);
    if (after) runs.push(...highlightTextWord(after, isHeader));
    return runs;
  };

  const highlightTextWord = (text: string, isHeader: boolean = false): TextRun[] => {
    const cleanText = text.replace(/\[BR\]/g, ''); 
    const font = "Times New Roman", size = 26; // 13pt
    
    const nlsRegex = /(\[NLS:.*?\]|NLS\.\d+\.\d+\.[A-Z0-9]+)/g;
    const parts = cleanText.split(nlsRegex);
    
    const finalRuns: TextRun[] = [];
    parts.forEach((part) => {
      if (!part) return;
      
      const isNLS = nlsRegex.test(part);
      nlsRegex.lastIndex = 0;
      
      if (isNLS) {
        finalRuns.push(new TextRun({ 
          text: part, 
          color: "ff0000", 
          bold: true, 
          italic: true, 
          font, 
          size 
        }));
      } else {
        finalRuns.push(new TextRun({ 
          text: part, 
          bold: isHeader,
          font, 
          size 
        }));
      }
    });
    
    return finalRuns.length > 0 ? finalRuns : [new TextRun({ text: cleanText, font, size, bold: isHeader })];
  };

  const renderRichText = (text: string) => {
    const nlsRegex = /(\[NLS:.*?\]|NLS\.\d+\.\d+\.[A-Z0-9]+)/g;
    const parts = text.split(nlsRegex);
    
    return parts.map((part, i) => {
      const isNLS = nlsRegex.test(part);
      nlsRegex.lastIndex = 0;
      
      if (isNLS) {
        return (
          <span key={i} className="inline-block bg-rose-100 text-rose-700 px-2 py-0.5 rounded-md font-bold text-sm mx-1 shadow-sm border border-rose-200">
            {part}
          </span>
        );
      }
      return <React.Fragment key={i}>{part}</React.Fragment>;
    });
  };

  const base64ToUint8Array = (base64: string): Uint8Array => {
    const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, '').replace(/\s/g, '');
    const binaryString = window.atob(cleanBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  };

  return (
    <div className="min-h-screen pb-20 bg-slate-50 selection:bg-emerald-100 selection:text-emerald-900">
      {/* Settings Drawer */}
      {isConfigOpen && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md transition-opacity duration-300" onClick={() => setIsConfigOpen(false)}></div>
          <div className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col transform transition-transform duration-500 ease-out border-l border-slate-200">
             <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0">
                <div>
                   <h2 className="text-2xl font-black text-slate-800 tracking-tight">Cấu hình Hệ thống</h2>
                   <p className="text-sm font-semibold text-slate-400 uppercase tracking-widest mt-1">Tùy chỉnh trí tuệ nhân tạo</p>
                </div>
                <button onClick={() => setIsConfigOpen(false)} className="w-12 h-12 rounded-full hover:bg-slate-100 flex items-center justify-center transition-all hover:rotate-90">
                   <svg className="w-7 h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
             </div>
             <div className="flex-1 overflow-y-auto p-8 bg-slate-50/30">
                <div className="space-y-6">
                   <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Hướng dẫn Hệ thống (System Prompt)</label>
                      <textarea 
                        className="w-full h-[450px] p-5 bg-slate-50 border border-slate-200 rounded-2xl font-mono text-xs leading-relaxed focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all outline-none resize-none scroll-smooth"
                        value={systemInstruction}
                        onChange={(e) => setSystemInstruction(e.target.value)}
                      />
                   </div>
                </div>
             </div>
             <div className="p-8 border-t border-slate-100 flex justify-end gap-4 bg-white">
                <button onClick={() => setSystemInstruction(DEFAULT_SYSTEM_INSTRUCTION)} className="px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors">Đặt lại mặc định</button>
                <button onClick={() => setIsConfigOpen(false)} className="bg-emerald-600 text-white px-10 py-4 rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl shadow-emerald-500/20 hover:bg-emerald-500 transition-all active:scale-95">Lưu cấu hình</button>
             </div>
          </div>
        </div>
      )}

      {/* Main Header */}
      <header className="glass sticky top-0 z-50 py-5 px-8 border-b border-emerald-100 paper-shadow">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-emerald-500/20">
               <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
            </div>
            <div>
              <h1 className="text-2xl font-black heading-font text-slate-900 tracking-tighter">EDTECH <span className="text-emerald-600">PRO</span></h1>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] leading-none">Hệ thống Tích hợp Năng lực số 3456</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button onClick={() => setIsConfigOpen(true)} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white border border-slate-200 text-slate-400 hover:border-emerald-200 hover:text-emerald-600 transition-all hover:bg-emerald-50 shadow-sm">
               <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
            </button>
            <nav className="flex bg-slate-200/50 p-1.5 rounded-[1.25rem] border border-slate-200 shadow-inner">
              <button onClick={() => setActiveTab('upload')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 ${activeTab === 'upload' ? 'bg-white shadow-md text-emerald-600 scale-100' : 'text-slate-500 hover:text-slate-800 scale-95'}`}>Tải lên</button>
              <button disabled={!analysisResult.length} onClick={() => setActiveTab('review')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 ${activeTab === 'review' ? 'bg-white shadow-md text-emerald-600 scale-100' : 'text-slate-500 hover:text-slate-800 scale-95 opacity-50'}`}>Phê duyệt</button>
              <button disabled={!resultPlan} onClick={() => setActiveTab('preview')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 ${activeTab === 'preview' ? 'bg-white shadow-md text-emerald-600 scale-100' : 'text-slate-500 hover:text-slate-800 scale-95 opacity-50'}`}>Kết quả</button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 mt-12">
        {isProcessing && (
           <div className="fixed inset-0 z-[200] bg-slate-900/40 backdrop-blur-xl flex flex-col items-center justify-center animate-in fade-in duration-500">
              <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl flex flex-col items-center max-w-md w-full border border-white/50 relative overflow-hidden">
                 <div className="absolute top-0 left-0 w-full h-1 bg-slate-100">
                    <div className="h-full bg-emerald-500 animate-[loading_2s_infinite]"></div>
                 </div>
                 <div className="relative w-36 h-36 mb-10">
                    <div className="absolute inset-0 border-[12px] border-emerald-50 rounded-full"></div>
                    <div className="absolute inset-0 border-[12px] border-t-emerald-500 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center text-5xl animate-pulse">🤖</div>
                 </div>
                 <h2 className="text-2xl font-black text-slate-800 tracking-tight text-center mb-4 uppercase">{processingStep}</h2>
                 <p className="text-slate-400 font-bold text-xs uppercase tracking-[0.2em] text-center animate-pulse">Đang cá thể hóa Năng lực số theo chương trình GDPT 2018...</p>
              </div>
           </div>
        )}

        {activeTab === 'upload' && (
          <div className="max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-8 duration-700">
             <div className="bg-white p-20 rounded-[4rem] border-2 border-dashed border-slate-200 text-center hover:border-emerald-400 transition-all duration-500 shadow-xl shadow-slate-200/50 group">
                <div className="w-28 h-28 mx-auto mb-10 rounded-[2.5rem] bg-indigo-50 flex items-center justify-center text-5xl shadow-inner group-hover:scale-110 transition-transform duration-500 group-hover:rotate-6">📁</div>
                <h2 className="text-3xl font-black heading-font text-slate-800 uppercase mb-5 tracking-tight">Kế hoạch Bài dạy</h2>
                <p className="text-slate-400 mb-12 font-semibold text-lg max-w-md mx-auto leading-relaxed">AI sẽ rà soát nội dung từng môn và đơn vị kiến thức để mô tả Năng lực số sát thực tế nhất.</p>
                
                <div className="space-y-6">
                   <label className="inline-flex items-center gap-4 bg-slate-900 text-white px-14 py-6 rounded-[2rem] font-black uppercase tracking-widest text-sm shadow-2xl cursor-pointer hover:bg-slate-800 hover:-translate-y-1 transition-all active:scale-95">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg>
                      {files.lessonPlan ? files.lessonPlan.name : 'Chọn File Word (.docx)'}
                      <input type="file" className="hidden" onChange={handleFileUpload} accept=".docx" />
                   </label>

                   {files.lessonPlan && (
                      <button onClick={startAnalysis} className="block w-full py-6 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-[2rem] font-black uppercase tracking-[0.2em] text-xs shadow-xl shadow-emerald-500/30 hover:shadow-emerald-500/40 hover:-translate-y-1 transition-all">
                         Bắt đầu phân tích & Đề xuất NLS
                      </button>
                   )}
                </div>
                
                <div className="mt-12 flex items-center justify-center gap-10 opacity-40">
                   <div className="flex flex-col items-center">
                      <span className="text-2xl font-black text-slate-900">3456</span>
                      <span className="text-[10px] font-black uppercase tracking-widest">BGDĐT Khung</span>
                   </div>
                   <div className="w-px h-8 bg-slate-300"></div>
                   <div className="flex flex-col items-center">
                      <span className="text-2xl font-black text-slate-900">2018</span>
                      <span className="text-[10px] font-black uppercase tracking-widest">GDPT Chương trình</span>
                   </div>
                </div>
             </div>
          </div>
        )}

        {activeTab === 'review' && (
          <div className="max-w-5xl mx-auto space-y-12 animate-in fade-in slide-in-from-right-8 duration-700">
             <div className="flex flex-col md:flex-row justify-between items-center md:items-end gap-6 bg-white p-10 rounded-[3rem] shadow-sm border border-slate-200">
                <div>
                   <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-4xl font-black text-slate-800 tracking-tighter uppercase">Thẩm định Sư phạm</h2>
                      <span className={`px-4 py-1.5 rounded-xl text-xs font-black uppercase tracking-widest ${detectedLevel === 'Tiểu học' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                         {detectedLevel || "Đang nhận diện..."}
                      </span>
                   </div>
                   <div className="flex items-center gap-3">
                      <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-[10px] font-black uppercase tracking-widest">Hệ thống đã sẵn sàng</span>
                      <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">AI đã chuẩn hóa {analysisResult.reduce((acc, curr) => acc + curr.suggestions.length, 0)} mô tả NLS cho {subjectInfo || 'bài học'}</p>
                   </div>
                </div>
                <button onClick={finalizeDocument} className="bg-slate-900 text-white px-12 py-5 rounded-[2rem] font-black uppercase text-xs tracking-[0.2em] shadow-2xl hover:bg-emerald-600 transition-all hover:-translate-y-1 flex items-center gap-4 group">
                   Xuất file kết quả
                   <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                </button>
             </div>

             <div className="grid grid-cols-1 gap-10">
                {analysisResult.map((seg, idx) => (
                   <div key={seg.id} className="group bg-white p-12 rounded-[4rem] border border-slate-200 shadow-xl shadow-slate-200/50 hover:border-emerald-300 transition-all duration-500 relative overflow-hidden">
                      <div className="absolute -top-10 -right-10 w-48 h-48 bg-emerald-50 rounded-full opacity-50 group-hover:scale-125 transition-transform duration-700"></div>
                      
                      <div className="relative">
                         <div className="flex items-center gap-5 mb-8">
                            <span className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-xl font-black shadow-lg">0{idx + 1}</span>
                            <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight">{seg.activityName || "Hoạt động Dạy học"}</h3>
                         </div>
                         
                         <div className="bg-slate-50/70 p-8 rounded-[2rem] border border-slate-100 mb-10 group-hover:bg-white transition-colors duration-500">
                            <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.3em] mb-4">Điểm mốc (Context Anchor):</p>
                            <p className="text-slate-600 italic font-bold text-lg leading-relaxed">"...{seg.originalText}..."</p>
                         </div>

                         <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {seg.suggestions.map((s) => (
                               <div key={s.code} className={`relative p-8 rounded-[3rem] border-2 transition-all duration-500 flex flex-col justify-between h-full ${s.accepted ? 'border-emerald-500 bg-emerald-50/40 shadow-xl shadow-emerald-500/10' : 'border-slate-100 bg-white opacity-40 grayscale'}`}>
                                  <div>
                                     <div className="flex justify-between items-start mb-6">
                                        <div className="flex flex-col gap-1">
                                           <span className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest w-fit ${s.accepted ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{s.code}</span>
                                        </div>
                                        <button onClick={() => toggleSuggestion(seg.id, s.code)} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-500 ${s.accepted ? 'bg-emerald-600 text-white shadow-xl shadow-emerald-500/30' : 'bg-slate-100 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600'}`}>
                                           <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              {s.accepted ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /> : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4" />}
                                           </svg>
                                        </button>
                                     </div>
                                     <h4 className="text-xl font-black text-slate-800 mb-4 leading-snug">{s.criteria}</h4>
                                     <div className="p-5 bg-white/80 rounded-[1.5rem] border border-white shadow-inner">
                                        <p className="text-[11px] text-slate-500 leading-relaxed font-bold italic"><span className="font-black text-emerald-700 uppercase tracking-tighter not-italic mr-2">Sư phạm:</span> {s.reason}</p>
                                     </div>
                                  </div>
                               </div>
                            ))}
                         </div>
                      </div>
                   </div>
                ))}
             </div>
          </div>
        )}

        {activeTab === 'preview' && resultPlan && (
          <div className="max-w-[1000px] mx-auto animate-in fade-in slide-in-from-bottom-8 duration-700">
             <div className="flex justify-center mb-10">
                <button onClick={downloadDocx} className="bg-emerald-600 text-white px-14 py-6 rounded-[2rem] font-black uppercase text-sm tracking-[0.2em] shadow-2xl hover:bg-emerald-500 transition-all hover:-translate-y-1 flex items-center gap-4">
                   <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                   Tải xuống Giáo án (.docx)
                </button>
             </div>

             <div className="bg-white p-20 md:p-32 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.15)] rounded-2xl border border-slate-200 min-h-[1200px] relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-3 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-500 animate-[gradient_3s_infinite]"></div>
                
                <div className="prose prose-slate max-w-none">
                  {resultPlan.fullContent.split('\n').map((line: string, i: number) => {
                    const trimmed = line.trim();
                    if (!trimmed) return <br key={i} />;
                    if (trimmed === "[START_TABLE]") return null;
                    if (trimmed === "[END_TABLE]") return null;
                    
                    if (line.includes("[COL_SEP]")) {
                      return (
                        <div key={i} className="grid grid-cols-[35%_65%] border border-slate-300 -mt-[1px] shadow-sm">
                          {trimmed.split("[COL_SEP]").map((col, ci) => (
                            <div key={ci} className={`p-6 text-[14px] border-r border-slate-300 last:border-0 ${ci === 0 ? 'bg-slate-50/80 font-black' : ''}`}>
                              {col.split('[BR]').map((b, bi) => <div key={bi} className="mb-3">{renderRichText(b)}</div>)}
                            </div>
                          ))}
                        </div>
                      );
                    }

                    const isTitle = trimmed.toUpperCase().includes("KẾ HOẠCH BÀI DẠY") || trimmed.toUpperCase().includes("BÀI :");
                    const isMainHeading = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)\./i.test(trimmed);
                    const isSubHeading = /^\d+\./.test(trimmed);
                    const isAlphaHeading = /^[a-z]\)/i.test(trimmed) || /^[a-z]\./i.test(trimmed);

                    return (
                      <p key={i} 
                         className={`mb-6 ${isTitle ? 'text-center text-3xl font-black uppercase text-emerald-700 my-16 tracking-tight leading-tight' : (isMainHeading || isSubHeading || isAlphaHeading) ? 'font-black text-slate-900 mt-10 text-lg border-l-4 border-emerald-500 pl-4' : 'text-[16px] leading-[1.8] text-slate-700'}`} 
                         style={{fontFamily: isMainHeading || isTitle ? '' : 'Times New Roman, serif'}}>
                        {renderRichText(trimmed)}
                      </p>
                    );
                  })}
                </div>

                <div className="mt-20 pt-10 border-t border-slate-100 flex justify-between items-center opacity-40 grayscale">
                   <div className="text-[10px] font-black uppercase tracking-widest">Tài liệu được hỗ trợ bởi AI Sư phạm | Phân loại: {detectedLevel}</div>
                   <div className="w-12 h-12 bg-slate-200 rounded-lg"></div>
                </div>
             </div>
          </div>
        )}
      </main>

      <footer className="mt-20 py-10 text-center border-t border-slate-100">
         <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.4em]">Được phát triển với giáo viên HD - 2025</p>
      </footer>
    </div>
  );
};

// --- Utils ---
const extractPdfText = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => (item as any).str).join(' ');
      fullText += pageText + '\n';
    }
    return fullText;
  } catch (err) {
    return "Lỗi đọc PDF.";
  }
};

const extractContentWithImages = async (file: File): Promise<{ text: string, images: ImageResource[] }> => {
  const buffer = await readFileAsArrayBuffer(file);
  const images: ImageResource[] = [];
  let imageCounter = 0;

  const options = {
    convertImage: mammoth.images.inline((element: any) => {
      return element.read("base64").then((base64Data: string) => {
        imageCounter++;
        const id = `[[IMAGE_RES_${imageCounter}]]`;
        images.push({ id, base64: base64Data, contentType: element.contentType });
        return { src: id };
      });
    })
  };

  const result = await mammoth.convertToHtml({ arrayBuffer: buffer }, options);
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = result.value;
  
  tempDiv.querySelectorAll('table').forEach(table => {
    let tableText = "\n[START_TABLE]\n";
    table.querySelectorAll('tr').forEach(row => {
      const cellTexts = Array.from(row.querySelectorAll('td, th')).map(c => (c as HTMLElement).innerText.trim().replace(/\n/g, ' [BR] '));
      tableText += cellTexts.join(" [COL_SEP] ") + "\n";
    });
    tableText += "[END_TABLE]\n";
    table.replaceWith(document.createTextNode(tableText));
  });

  tempDiv.querySelectorAll('img').forEach(img => {
    const marker = img.getAttribute('src');
    if (marker) img.replaceWith(document.createTextNode(`\n${marker}\n`));
  });

  return { text: tempDiv.innerText || "", images };
};

const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
};

export default App;
