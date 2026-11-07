// Stub DOM minimale per i test Node.
// Supporta ciò che usa il plugin: createElement, append/appendChild,
// textContent get/set, className, id, title, hidden, querySelector/
// querySelectorAll (#id | .class | tag | combinazioni discendenti).
export function createDomStub() {
  class Node {
    constructor(tag = "node") {
      this.tag = tag;
      this.children = [];
      this.parent = null;
      this.isConnected = false;
      this.className = "";
      this.id = "";
      this.title = "";
      this.hidden = false;
      this.style = {};
      this._attrs = {};
      this._textValue = "";
      this.dataset = {};
      this._listeners = new Map();
      this.disabled = false;
      this.tabIndex = 0;
      this.classList = {
        add: (...names) => { const set = new Set(String(this.className).split(/\s+/).filter(Boolean)); for (const n of names) set.add(n); this.className = [...set].join(" "); },
        remove: (...names) => { const set = new Set(String(this.className).split(/\s+/).filter(Boolean)); for (const n of names) set.delete(n); this.className = [...set].join(" "); },
        contains: (name) => String(this.className).split(/\s+/).includes(name),
        toggle: (name, force) => {
          const has = String(this.className).split(/\s+/).includes(name);
          const next = force === undefined ? !has : Boolean(force);
          if (next) this.classList.add(name); else this.classList.remove(name);
          return next;
        },
      };
    }

    setAttribute(name, value) { this._attrs[name] = String(value); }
    getAttribute(name) { return Object.hasOwn(this._attrs, name) ? this._attrs[name] : null; }
    removeAttribute(name) { delete this._attrs[name]; }

    // Listener minimi: i test li attivano con el.fire("click").
    addEventListener(type, fn) {
      const list = this._listeners.get(type) ?? [];
      list.push(fn);
      this._listeners.set(type, list);
    }

    fire(type, event = {}) {
      const ev = { type, target: this, preventDefault() {}, ...event };
      for (const fn of this._listeners.get(type) ?? []) fn(ev);
      return ev;
    }

    focus() { this._focused = true; }

    replaceWith(node) {
      const p = this.parent;
      if (!p) return;
      const i = p.children.indexOf(this);
      if (i >= 0) p.children[i] = node;
      if (node.tag !== "#fragment") node.parent = p;
    }

    appendChild(node) {
      if (typeof node === "string") {
        const t = new Node("text");
        t._textValue = String(node);
        node = t;
      }
      // Un DocumentFragment si svuota dentro il genitore (come nel DOM reale).
      if (node.tag === "#fragment") {
        for (const child of node.children.splice(0)) {
          child.parent = this;
          this.children.push(child);
        }
        return node;
      }
      this.children.push(node);
      node.parent = this;
      return node;
    }

    append(...xs) {
      for (const x of xs) this.appendChild(x);
      return this;
    }

    remove() {
      const p = this.parent;
      if (p) p.children.splice(p.children.indexOf(this), 1);
      this.parent = null;
    }

    _descendants() {
      const out = [];
      const walk = (n) => {
        for (const c of n.children) {
          out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }

    // Supporta anche i selettori composti: "article.os-doc", "button#id",
    // ".a.b", oltre ai singoli tag / classe / id.
    _matches(step) {
      const parts = step.match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/);
      if (parts === null) return false;
      const [, tag, rest] = parts;
      if (tag !== undefined && this.tag !== tag) return false;
      const classes = (rest.match(/\.([\w-]+)/g) ?? []).map(c => c.slice(1));
      const ids = (rest.match(/#([\w-]+)/g) ?? []).map(c => c.slice(1));
      for (const id of ids) if (this.id !== id) return false;
      const own = (this.className || "").toString().split(/\s+/).filter(Boolean);
      for (const cls of classes) if (!own.includes(cls)) return false;
      return tag !== undefined || classes.length > 0 || ids.length > 0;
    }

    // Catene di discendenti (es. ".change .name"): il nodo deve matchare l'
    // ultimo step e la catena di antenati (radice->genitore) deve contenere
    // gli step precedenti in ordine (sotto-sequenza).
    _matchesChain(node, steps) {
      const last = steps[steps.length - 1];
      if (!node._matches(last)) return false;
      const needed = steps.slice(0, steps.length - 1);
      if (needed.length === 0) return true;
      const anc = [];
      let a = node.parent;
      while (a) { anc.unshift(a); a = a.parent; }
      let idx = 0;
      for (const an of anc) {
        if (an._matches(needed[idx])) idx++;
        if (idx === needed.length) return true;
      }
      return false;
    }

    querySelector(sel) {
      const steps = sel.trim().split(/\s+/);
      const out = [];
      const walk = (n) => {
        for (const c of n.children) {
          if (this._matchesChain(c, steps)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out[0] ?? null;
    }

    querySelectorAll(sel) {
      const steps = sel.trim().split(/\s+/);
      const out = [];
      const walk = (n) => {
        for (const c of n.children) {
          if (this._matchesChain(c, steps)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }

    get textContent() {
      if (this.children.length === 0) return this._textValue;
      return this.children.map((c) => c.textContent).join("");
    }

    set textContent(v) {
      this.children = [];
      this._textValue = v == null ? "" : String(v);
    }
  }

  class HTMLElement extends Node {
    // Shadow DOM minimale: PI WEB monta i pannelli dentro shadow root e il
    // plugin ci mette il proprio <style>. Lo stub deve offrire attachShadow e
    // shadowRoot, altrimenti i test non vedrebbero il markup reale.
    constructor(tag = "node") {
      super(tag);
      this.shadowRoot = null;
    }

    attachShadow() {
      if (this.shadowRoot !== null) throw new Error("attachShadow puo' essere chiamato una volta sola");
      const root = new Node("#shadow-root");
      root.host = this;
      this.shadowRoot = root;
      return root;
    }

    getRootNode() {
      return this.shadowRoot !== null ? this.shadowRoot : this;
    }
  }

  const head = new HTMLElement("head");

  const document = {
    head,
    createElement(tag) {
      return new HTMLElement(tag);
    },
    createDocumentFragment() {
      return new Node("#fragment");
    },
    createTextNode(text) {
      const n = new Node("text");
      n._textValue = String(text);
      return n;
    },
    createElementNS(_ns, tag) {
      return new HTMLElement(tag);
    },
    // Basta cercare in head: e' li' che il plugin inietta il suo <style>.
    getElementById(id) {
      return head.querySelector(`#${id}`) ?? null;
    },
    querySelector: null,
    querySelectorAll: null,
  };

  return { document, HTMLElement };
}
