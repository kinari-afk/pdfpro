import React, { useState, useMemo } from 'react';
import {
  Search,
  Download,
  ExternalLink,
  FileText,
  ImageIcon,
  Archive,
  File,
  Loader2,
  AlertCircle,
  Filter,
  Trash2,
  Globe,
} from 'lucide-react';

// APIキーはプラットフォームによって実行時にこの変数へ注入されます。
const apiKey = '';

const App = () => {
  const [url, setUrl] = useState('');
  const [links, setLinks] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  /**
   * Gemini APIを呼び出すメイン関数
   * 認証の安定性を高めるため、極限までシンプルなリクエスト構造を使用します。
   */
  const fetchLinksWithGemini = async (targetUrl) => {
    // 実行環境で唯一サポートされているモデル
    const model = 'gemini-2.5-flash-preview-09-2025';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // システム指示とユーザー要求を1つのテキストに統合（401エラー回避のため）
    const userPrompt = `
      あなたはWeb解析エキスパートです。Google Searchツールを使って以下のURLにアクセスし、ページ内のすべてのユニークなハイパーリンク（絶対パス）を抽出してください。
      URL: ${targetUrl}

      抽出したリンクを以下の5つのカテゴリのいずれかに分類して、必ず有効なJSON形式で返してください。
      カテゴリ: 'document', 'image', 'archive', 'page', 'other'

      JSON構造:
      {
        "links": [
          { "text": "リンク名", "url": "https://...", "type": "カテゴリ" }
        ]
      }
    `;

    const maxRetries = 5;
    const backoffDelays = [1000, 2000, 4000, 8000, 16000];

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: userPrompt }],
              },
            ],
            tools: [{ google_search: {} }],
            generationConfig: {
              responseMimeType: 'application/json',
              // スキーマ定義を最小限に留め、解析の失敗を防ぐ
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  links: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        text: { type: 'string' },
                        url: { type: 'string' },
                        type: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          }),
        });

        if (!response.ok) {
          const status = response.status;
          if (status === 401) {
            throw new Error(
              `認証エラー(401): プラットフォームのAPIキー適用を待機しています... (${i + 1}/${maxRetries})`,
            );
          }
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || `API Error ${status}`);
        }

        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!content) throw new Error('APIから結果が返されませんでした。');

        return JSON.parse(content);
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);

        // 401以外の致命的なエラーは即座に終了
        if (!errMessage.includes('401') && !errMessage.includes('429')) {
          throw err;
        }
        if (i === maxRetries - 1) throw err;

        // 指数バックオフ
        await new Promise((r) => setTimeout(r, backoffDelays[i]));
      }
    }

    throw new Error('リンク抽出に失敗しました。');
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    let cleanUrl = url.trim();
    if (!cleanUrl) return;

    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = `https://${cleanUrl}`;
    }

    setIsLoading(true);
    setError(null);
    setLinks([]);

    try {
      const data = await fetchLinksWithGemini(cleanUrl);
      if (data?.links && data.links.length > 0) {
        setLinks(data.links);
      } else {
        setError('ページ内に抽出可能なリンクが見つかりませんでした。');
      }
    } catch (err) {
      console.error('App Error:', err);
      const errMessage = err instanceof Error ? err.message : '予期せぬエラーが発生しました。';
      setError(errMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredLinks = useMemo(() => {
    return links.filter((l) => {
      const typeMatch = filterType === 'all' || l.type === filterType;
      const searchMatch = `${l.text}${l.url}`.toLowerCase().includes(searchTerm.toLowerCase());
      return typeMatch && searchMatch;
    });
  }, [links, filterType, searchTerm]);

  const handleDownloadAction = (fileUrl, fileName) => {
    // ブラウザのセキュリティ設定を考慮し、新しいウィンドウで開く
    const a = document.createElement('a');
    a.href = fileUrl;
    a.download = fileName || 'download';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const renderIcon = (type) => {
    switch (type) {
      case 'document':
        return <FileText className="w-5 h-5 text-blue-500" />;
      case 'image':
        return <ImageIcon className="w-5 h-5 text-emerald-500" />;
      case 'archive':
        return <Archive className="w-5 h-5 text-orange-600" />;
      case 'page':
        return <Globe className="w-5 h-5 text-indigo-500" />;
      default:
        return <File className="w-5 h-5 text-slate-400" />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-900 font-sans">
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-10">
          <h1 className="text-4xl font-black text-slate-800 flex items-center justify-center gap-3 tracking-tighter">
            <Search className="w-10 h-10 text-blue-600" />
            リンク抽出アプリ
          </h1>
          <p className="text-slate-500 mt-4 text-lg font-medium opacity-80">
            Gemini AIがWebサイトをスキャンし、リンクを自動分類します。
          </p>
        </header>

        <section className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200 p-6 md:p-8 mb-8">
          <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-lg font-medium"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold py-4 px-10 rounded-2xl flex items-center justify-center gap-3 disabled:opacity-50 transition-all shadow-lg shadow-blue-200 min-w-[180px]"
            >
              {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Search className="w-6 h-6" />}
              {isLoading ? 'スキャン中...' : '抽出を開始'}
            </button>
          </form>
        </section>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 p-6 rounded-2xl mb-8 flex items-start gap-4 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="w-6 h-6 flex-shrink-0 mt-0.5 text-red-600" />
            <div className="flex-1">
              <p className="font-bold text-lg mb-1">エラーが発生しました</p>
              <p className="text-sm leading-relaxed opacity-90 font-medium">{error}</p>
              <p className="text-xs mt-2 text-red-400 italic">
                ※401エラーが続く場合は、数分置いてから再読み込みをお試しください。
              </p>
            </div>
          </div>
        )}

        {links.length > 0 && (
          <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white/90 backdrop-blur-md p-4 rounded-2xl border border-slate-200 shadow-sm sticky top-4 z-10">
              <div className="flex gap-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0 no-scrollbar">
                {[
                  { id: 'all', name: 'すべて' },
                  { id: 'document', name: '書類' },
                  { id: 'image', name: '画像' },
                  { id: 'archive', name: '圧縮' },
                  { id: 'page', name: 'ページ' },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setFilterType(t.id)}
                    className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
                      filterType === t.id
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              <div className="w-full md:w-72">
                <input
                  type="text"
                  placeholder="結果内をキーワード検索..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-inner"
                />
              </div>
            </div>

            <div className="grid gap-4 pb-12">
              {filteredLinks.length > 0 ? (
                filteredLinks.map((item, idx) => (
                  <div
                    key={idx}
                    className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-blue-300 transition-all group flex items-center justify-between gap-6"
                  >
                    <div className="flex items-center gap-5 min-w-0">
                      <div className="p-3 bg-slate-50 rounded-xl group-hover:bg-blue-50 transition-colors shrink-0">
                        {renderIcon(item.type)}
                      </div>
                      <div className="min-w-0 text-left">
                        <h3 className="font-bold text-slate-800 truncate text-base leading-tight" title={item.text}>
                          {item.text || '名称不明のリンク'}
                        </h3>
                        <p
                          className="text-xs text-slate-400 truncate mt-1.5 font-mono tracking-tighter opacity-70"
                          title={item.url}
                        >
                          {item.url}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleDownloadAction(item.url, item.text)}
                        className="p-3 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                        title="保存を試行"
                      >
                        <Download className="w-6 h-6" />
                      </button>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-3 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                        title="新しいタブで開く"
                      >
                        <ExternalLink className="w-6 h-6" />
                      </a>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-24 bg-white rounded-3xl border border-dashed border-slate-300">
                  <Filter className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-400 font-bold">一致するリンクがありません。</p>
                </div>
              )}
            </div>

            <div className="text-center pb-12">
              <button
                onClick={() => setLinks([])}
                className="text-sm font-bold text-slate-400 hover:text-red-500 transition-all px-4 py-2 hover:bg-red-50 rounded-xl inline-flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                結果を全削除
              </button>
            </div>
          </div>
        )}

        {!isLoading && links.length === 0 && !error && (
          <div className="text-center py-28 border-4 border-dashed border-slate-200 rounded-[50px] bg-slate-50/50">
            <Globe className="w-20 h-20 text-slate-200 mx-auto mb-8 animate-pulse" />
            <h2 className="text-2xl font-black text-slate-400 tracking-tight">URLを入力して解析を開始</h2>
            <p className="text-slate-400 mt-2 text-sm max-w-sm mx-auto">
              Web上の公開情報をAIが読み取り、リンク先を分類してリスト化します。
            </p>
          </div>
        )}
      </div>

      <footer className="mt-16 text-center text-[11px] text-slate-400 max-w-2xl mx-auto border-t border-slate-200 pt-10 pb-16 leading-relaxed px-6">
        <p className="font-bold mb-2 text-slate-500 uppercase tracking-widest text-[10px]">Information</p>
        <p>※ Google Searchを利用して最新のページ構造を取得します。</p>
        <p className="mt-2 leading-relaxed opacity-80">
          ※
          サイト側のCORS制限により、直接ダウンロードが失敗する場合があります。その際は「新しいタブで開く」アイコンからリンク先を表示し、手動で保存を行ってください。
        </p>
      </footer>
    </div>
  );
};

export default App;
