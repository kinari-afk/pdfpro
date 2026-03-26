import os
import threading
import tkinter as tk
from html.parser import HTMLParser
from tkinter import filedialog, messagebox, ttk
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


class LinkExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "a":
            return
        attr_map = dict(attrs)
        href = attr_map.get("href")
        if href:
            self.links.append(href)


class LinkDownloaderApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Webリンク抽出&ダウンローダー")
        self.root.geometry("860x560")

        self.url_var = tk.StringVar()
        self.status_var = tk.StringVar(value="URLを入力してリンク抽出を押してください。")
        self.save_dir_var = tk.StringVar(value=os.getcwd())
        self.links = []

        self._build_ui()

    def _build_ui(self):
        wrapper = ttk.Frame(self.root, padding=12)
        wrapper.pack(fill="both", expand=True)

        url_frame = ttk.Frame(wrapper)
        url_frame.pack(fill="x", pady=(0, 10))

        ttk.Label(url_frame, text="対象URL:").pack(side="left")
        url_entry = ttk.Entry(url_frame, textvariable=self.url_var)
        url_entry.pack(side="left", fill="x", expand=True, padx=8)
        url_entry.focus()

        ttk.Button(url_frame, text="リンク抽出", command=self.extract_links).pack(side="left")

        dir_frame = ttk.Frame(wrapper)
        dir_frame.pack(fill="x", pady=(0, 10))

        ttk.Label(dir_frame, text="保存先:").pack(side="left")
        ttk.Entry(dir_frame, textvariable=self.save_dir_var).pack(
            side="left", fill="x", expand=True, padx=8
        )
        ttk.Button(dir_frame, text="参照", command=self.select_directory).pack(side="left")

        list_frame = ttk.Frame(wrapper)
        list_frame.pack(fill="both", expand=True)

        self.link_list = tk.Listbox(list_frame, selectmode=tk.EXTENDED)
        self.link_list.pack(side="left", fill="both", expand=True)

        scrollbar = ttk.Scrollbar(list_frame, orient="vertical", command=self.link_list.yview)
        scrollbar.pack(side="right", fill="y")
        self.link_list.config(yscrollcommand=scrollbar.set)

        action_frame = ttk.Frame(wrapper)
        action_frame.pack(fill="x", pady=(10, 0))

        ttk.Button(action_frame, text="選択リンクをダウンロード", command=self.download_selected).pack(
            side="left"
        )
        ttk.Button(action_frame, text="全選択", command=self.select_all).pack(side="left", padx=8)
        ttk.Button(action_frame, text="選択解除", command=self.clear_selection).pack(side="left")

        status = ttk.Label(wrapper, textvariable=self.status_var, relief="sunken", anchor="w")
        status.pack(fill="x", pady=(10, 0))

    def set_status(self, text: str):
        self.status_var.set(text)

    def select_directory(self):
        directory = filedialog.askdirectory(initialdir=self.save_dir_var.get() or os.getcwd())
        if directory:
            self.save_dir_var.set(directory)

    def extract_links(self):
        url = self.url_var.get().strip()
        if not url:
            messagebox.showwarning("入力エラー", "URLを入力してください。")
            return

        threading.Thread(target=self._extract_links_worker, args=(url,), daemon=True).start()

    def _extract_links_worker(self, base_url: str):
        self.root.after(0, lambda: self.set_status("リンク抽出中..."))
        try:
            req = Request(base_url, headers={"User-Agent": "Mozilla/5.0"})
            with urlopen(req, timeout=20) as res:
                content_type = res.headers.get("Content-Type", "")
                raw = res.read()

            if "text/html" not in content_type and b"<html" not in raw[:500].lower():
                raise ValueError("指定URLはHTMLページではありません。")

            html = raw.decode("utf-8", errors="ignore")
            parser = LinkExtractor()
            parser.feed(html)

            normalized = []
            seen = set()
            for link in parser.links:
                absolute = urljoin(base_url, link)
                if absolute in seen:
                    continue
                seen.add(absolute)
                normalized.append(absolute)

            self.root.after(0, lambda: self._update_link_list(normalized))
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("抽出エラー", str(e)))
            self.root.after(0, lambda: self.set_status("リンク抽出に失敗しました。"))

    def _update_link_list(self, links):
        self.links = links
        self.link_list.delete(0, tk.END)
        for link in links:
            self.link_list.insert(tk.END, link)
        self.set_status(f"{len(links)} 件のリンクを抽出しました。")

    def select_all(self):
        if self.links:
            self.link_list.select_set(0, tk.END)

    def clear_selection(self):
        self.link_list.select_clear(0, tk.END)

    def download_selected(self):
        selected_indices = self.link_list.curselection()
        if not selected_indices:
            messagebox.showinfo("未選択", "ダウンロードするリンクを選択してください。")
            return

        save_dir = self.save_dir_var.get().strip() or os.getcwd()
        os.makedirs(save_dir, exist_ok=True)

        selected_links = [self.links[i] for i in selected_indices]
        threading.Thread(
            target=self._download_worker, args=(selected_links, save_dir), daemon=True
        ).start()

    def _download_worker(self, links, save_dir):
        success = 0
        fail = 0

        for idx, link in enumerate(links, start=1):
            self.root.after(0, lambda i=idx, t=len(links): self.set_status(f"ダウンロード中 {i}/{t} ..."))
            try:
                req = Request(link, headers={"User-Agent": "Mozilla/5.0"})
                with urlopen(req, timeout=30) as res:
                    data = res.read()
                    filename = self._resolve_filename(link, res.headers.get("Content-Disposition"))

                path = os.path.join(save_dir, filename)
                base, ext = os.path.splitext(path)
                suffix = 1
                while os.path.exists(path):
                    path = f"{base}_{suffix}{ext}"
                    suffix += 1

                with open(path, "wb") as f:
                    f.write(data)
                success += 1
            except Exception:
                fail += 1

        self.root.after(
            0,
            lambda: self.set_status(f"完了: 成功 {success} 件 / 失敗 {fail} 件"),
        )

    @staticmethod
    def _resolve_filename(url: str, content_disposition: str | None):
        if content_disposition and "filename=" in content_disposition:
            fname = content_disposition.split("filename=")[-1].strip().strip('"')
            if fname:
                return fname

        parsed = urlparse(url)
        name = os.path.basename(parsed.path)
        return name or "downloaded_file"


def main():
    root = tk.Tk()
    app = LinkDownloaderApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
