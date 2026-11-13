/*****************************************************************************
 * MONITORAMENTO DA ENSINO FUNDAMENTAL · ANOS INICIAIS · API (Google Apps Script)
 *
 * A planilha é o banco de dados. Este script é o "servidor": valida o CPF
 * (formato e dígitos verificadores), decide quem pode ver/gravar o quê e grava
 * na planilha com trava (LockService) para que dois usuários salvando ao mesmo
 * tempo não percam dados.
 *
 * INSTALAÇÃO (uma vez só)
 *  1. Crie uma planilha nova no Google Sheets (conta institucional da Secretaria).
 *     NÃO compartilhe essa planilha com ninguém: ela guarda CPFs.
 *  2. Extensões > Apps Script. Apague o conteúdo e cole este arquivo inteiro.
 *  3. (Opcional) Troque ADMIN_INICIAL pelo seu CPF. Se deixar 000.000.000-00,
 *     o primeiro CPF válido que fizer login no site será registrado automaticamente
 *     como Administrador!
 *  4. No menu de funções, escolha configurarPlanilha e clique em Executar.
 *     Autorize o acesso quando o Google pedir. As abas e dados padrão são criados.
 *     (Opcional, para testar: execute também carregarDadosDeExemplo).
 *  5. Implantar > Nova implantação > tipo "App da Web":
 *        Executar como:  Eu
 *        Quem tem acesso: Qualquer pessoa
 *     Copie a URL que termina em /exec e cole em API_URL no index.html.
 *  6. (Recomendado) Defina uma senha para o administrador:
 *     Configurações do projeto (engrenagem) > Propriedades do script >
 *     adicionar SENHA_ADMIN com a senha. Sem essa propriedade, o administrador
 *     entra só com o CPF.
 *
 * ATUALIZAÇÃO DO CÓDIGO: depois de alterar, Implantar > Gerenciar implantações >
 * lápis > Versão: "Nova versão" > Implantar. A URL continua a mesma.
 *****************************************************************************/


const ADMIN_INICIAL = '000.000.000-00';   // Se deixar padrão, o 1º login válido vira Administrador
const NOME_ADMIN_INICIAL = 'Administrador';
const SESSAO_SEGUNDOS = 6 * 60 * 60;
const MAX_TENTATIVAS = 5;

/* ---------- ESTRUTURA DAS ABAS (a planilha é o banco de dados) ----------
   f = [cabeçalho na planilha, campo usado pelo site, tipo]
   tipos: s texto | n número | b SIM/NÃO | l lista separada por vírgula | c CPF */
const SPEC = {
  years:    { sheet: 'Anos',           f: [['id','id','s'],['nome','name','s']] },
  levels:   { sheet: 'Anos_Escolares', f: [['id','id','s'],['nome','name','s'],['ordem','ord','n']] },
  schools:  { sheet: 'Escolas',        f: [['id','id','s'],['nome','name','s'],['anos_escolares','lids','l']] },
  classes:  { sheet: 'Turmas',         f: [['id','id','s'],['ano_id','yid','s'],['escola_id','sid','s'],['nome','name','s'],['ano_escolar_id','lid','s'],['professor','prof','s'],['turno','shift','s']] },
  students: { sheet: 'Alunos',         f: [['id','id','s'],['turma_id','cid','s'],['nome','name','s'],['ano_escolar_id','lid','s']] },
  periods:  { sheet: 'Periodos',       f: [['id','id','s'],['ano_id','yid','s'],['nome','name','s'],['aberto','open','b']] },
  recs:     { sheet: 'Avaliacoes',     f: [['aluno_id','aid','s'],['turma_id','cid','s'],['periodo_id','pid','s'],['escrita','w','s'],['leitura','r','s'],['atualizado_em','at','s'],['atualizado_por','by','s']] },
  coords:   { sheet: 'Coordenadores',  f: [['cpf','cpf','c'],['nome','name','s'],['escolas','sids','l']] },
  admins:   { sheet: 'Admins',         f: [['cpf','cpf','c'],['nome','name','s']] },
  cfg:      { sheet: 'Config',         f: [['chave','k','s'],['valor','v','s']] }
};
const EDITAVEIS = ['years','levels','schools','classes','periods','coords','admins'];
const ANOS_PADRAO = ['1º Ano', '2º Ano', '3º Ano', '4º Ano', '5º Ano'];
/* Níveis (iguais aos da planilha de diagnóstico). Os ids precisam bater com o index.html */
const NIVEIS_ESCRITA = ['pre', 'ssv', 'scv', 'sal', 'alf', 'ort'];  // Pré-silábico, Silábico s/valor, Silábico c/valor, Silábico alfabético, Alfabético, Ortográfico
const NIVEIS_LEITURA = ['n1', 'n2', 'n3', 'n4', 'ini', 'flu'];      // Pré-leitor nível 1-4, Leitor iniciante, Leitor fluente

/* ================= PONTOS DE ENTRADA ================= */
function doGet(e) {
  try {
    garantirInicializacao_();
    if (e && e.parameter) {
      if (e.parameter.setup === '1' || e.parameter.init === '1') {
        configurarPlanilha();
        return saida_({ ok: true, msg: 'Planilha configurada e inicializada com sucesso.' });
      }
      if (e.parameter.exemplo === '1' || e.parameter.dados === '1') {
        carregarDadosDeExemplo();
        return saida_({ ok: true, msg: 'Dados de exemplo inseridos com sucesso na planilha.' });
      }
    }
    return saida_({ ok: true, msg: 'API do Ensino Fundamental I no ar e banco de dados sincronizado.' });
  } catch (err) {
    return saida_({ ok: false, err: 'Erro no doGet: ' + (err && err.message ? err.message : String(err)) });
  }
}

function doPost(e) {
  let out;
  try {
    _DB = {};
    garantirInicializacao_();
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (req.a === 'login') out = login_(req);
    else if (req.a === 'load') out = carregar_(req);
    else if (req.a === 'write') out = gravar_(req);
    else if (req.a === 'logout') out = sair_(req);
    else if (req.a === 'setup' || req.a === 'init') {
      configurarPlanilha();
      out = { ok: true, msg: 'Planilha configurada com sucesso.' };
    }
    else if (req.a === 'exemplo') {
      carregarDadosDeExemplo();
      out = { ok: true, msg: 'Dados de exemplo carregados na planilha com sucesso.' };
    }
    else falha_('Pedido inválido.');
  } catch (err) {
    if (err && err.usuario) out = { ok: false, err: err.msg, code: err.code || '' };
    else {
      console.error(err && err.stack ? err.stack : err);
      out = { ok: false, err: 'Erro interno do servidor: ' + (err && err.message ? err.message : String(err)) };
    }
  }
  return saida_(out);
}

function saida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function falha_(msg, code) { throw { usuario: true, msg: msg, code: code || '' }; }
function falhaAuth_() { falha_('Sessão expirada. Entre novamente.', 'auth'); }

/* ================= ACESSO À PLANILHA ================= */
let _DB = {};
const digits_ = v => String(v == null ? '' : v).replace(/\D/g, '');
const cpfNorm_ = v => { const d = digits_(v); return d.length && d.length < 11 ? ('00000000000' + d).slice(-11) : d; };
const idOk_ = v => /^[A-Za-z0-9_-]{1,24}$/.test(String(v));

/* CPF válido = 11 números, não todos iguais, e os 2 dígitos verificadores batendo */
function cpfValido_(c) {
  c = String(c);
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}

function folha_(nome) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) falha_('Planilha ativa não encontrada. Verifique se o script está dentro da planilha.');
  let sh = ss.getSheetByName(SPEC[nome].sheet);
  const nc = SPEC[nome].f.length;
  if (!sh) {
    sh = ss.insertSheet(SPEC[nome].sheet);
    if (sh.getMaxColumns() < nc) sh.insertColumnsAfter(sh.getMaxColumns(), nc - sh.getMaxColumns());
    sh.getRange(1, 1, 1, nc).setValues([SPEC[nome].f.map(c => c[0])]).setFontWeight('bold').setBackground('#E4F2EA');
    sh.setFrozenRows(1);
  } else {
    if (sh.getMaxColumns() < nc) {
      sh.insertColumnsAfter(sh.getMaxColumns(), nc - sh.getMaxColumns());
    }
    const curHeaders = sh.getRange(1, 1, 1, nc).getValues()[0];
    const expHeaders = SPEC[nome].f.map(c => c[0]);
    let mudou = false;
    for (let i = 0; i < expHeaders.length; i++) {
      if (curHeaders[i] !== expHeaders[i]) { mudou = true; break; }
    }
    if (mudou) {
      sh.getRange(1, 1, 1, nc).setValues([expHeaders]).setFontWeight('bold').setBackground('#E4F2EA');
    }
  }
  return sh;
}

function doLinha_(s, r) {
  const o = {};
  s.f.forEach((c, i) => {
    const v = r[i], t = c[2];
    if (t === 'n') o[c[1]] = Number(v) || 0;
    else if (t === 'b') o[c[1]] = v === true || /^(SIM|TRUE)$/i.test(String(v).trim());
    else if (t === 'l') o[c[1]] = String(v == null ? '' : v).split(',').map(x => x.trim()).filter(Boolean);
    else if (t === 'c') o[c[1]] = cpfNorm_(v);
    else o[c[1]] = String(v == null ? '' : v).trim();
  });
  return o;
}
function paraLinha_(s, o) {
  return s.f.map(c => {
    const v = o[c[1]], t = c[2];
    if (t === 'n') return Number(v) || 0;
    if (t === 'b') return v ? 'SIM' : 'NÃO';
    if (t === 'l') return Array.isArray(v) ? v.join(',') : String(v || '');
    if (t === 'c') return cpfNorm_(v);
    return String(v == null ? '' : v);
  });
}

function tbl_(nome) {
  if (_DB[nome]) return _DB[nome];
  const s = SPEC[nome], sh = folha_(nome), last = sh.getLastRow();
  let rows = [];
  if (last > 1) {
    rows = sh.getRange(2, 1, last - 1, s.f.length).getValues()
      .filter(r => String(r[0]).trim() !== '').map(r => doLinha_(s, r));
  }
  if (nome === 'levels' || nome === 'inds') rows.sort((a, b) => a.ord - b.ord);
  return (_DB[nome] = { rows: rows, dirty: false });
}

function gravarTabela_(nome) {
  const s = SPEC[nome], sh = folha_(nome), t = _DB[nome];
  if (!t) return;
  const n = t.rows.length, nc = s.f.length;
  if (sh.getMaxColumns() < nc) sh.insertColumnsAfter(sh.getMaxColumns(), nc - sh.getMaxColumns());
  const antes = Math.max(0, sh.getLastRow() - 1);
  if (n > 0) {
    if (sh.getMaxRows() < n + 1) sh.insertRowsAfter(sh.getMaxRows(), n + 1 - sh.getMaxRows());
    const rg = sh.getRange(2, 1, n, nc);
    try {
      rg.setNumberFormats(t.rows.map(() => s.f.map(c => c[2] === 'n' ? 'General' : '@')));
    } catch (e) {
      console.warn('setNumberFormats aviso:', e);
    }
    rg.setValues(t.rows.map(o => paraLinha_(s, o)));
  }
  if (antes > n) {
    sh.getRange(n + 2, 1, antes - n, nc).clearContent();
  }
  t.dirty = false;
}

function gravarTudo_() {
  Object.keys(_DB).forEach(n => { if (_DB[n].dirty) gravarTabela_(n); });
  SpreadsheetApp.flush();
}
const sujar_ = n => { tbl_(n).dirty = true; };

/* ---- ano vigente (aba Config) ---- */
function anoVigente_() {
  const anos = tbl_('years').rows, c = tbl_('cfg').rows.find(r => r.k === 'ano_vigente');
  if (c && anos.some(a => a.id === c.v)) return c.v;
  return anos.length ? anos[0].id : '';
}
function definirVigente_(id) {
  const t = tbl_('cfg'), c = t.rows.find(r => r.k === 'ano_vigente');
  if (c) c.v = id; else t.rows.push({ k: 'ano_vigente', v: id });
  t.dirty = true;
}

/* ================= SESSÃO E LOGIN ================= */
function igual_(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

function quemE_(s) {
  if (s.role === 'admin') {
    const a = tbl_('admins').rows.find(x => x.cpf === s.cpf);
    if (!a) falhaAuth_();
    return { role: 'admin', cpf: s.cpf, name: a.name || 'Administrador' };
  }
  const k = tbl_('coords').rows.find(x => x.cpf === s.cpf);
  if (!k) falhaAuth_();
  const escolas = tbl_('schools').rows;
  return { role: 'coord', cpf: s.cpf, name: k.name, sids: k.sids.filter(id => escolas.some(e => e.id === id)) };
}
function sessao_(token) {
  if (!token || typeof token !== 'string') falhaAuth_();
  const cache = CacheService.getScriptCache();
  const raw = cache.get('s_' + token);
  if (!raw) falhaAuth_();
  cache.put('s_' + token, raw, SESSAO_SEGUNDOS);
  return quemE_(JSON.parse(raw));
}

function login_(req) {
  const cpf = cpfNorm_(req.cpf);
  if (cpf.length !== 11) falha_('Digite os 11 números do CPF.');
  if (!cpfValido_(cpf)) falha_('CPF inválido. Confira os números.');
  const cache = CacheService.getScriptCache();
  if (cache.get('bloq_' + cpf)) falha_('Muitas tentativas. Aguarde 15 minutos e tente novamente.');

  let quem;
  // Se ainda não há nenhum administrador cadastrado, o primeiro CPF válido que fizer login vira Administrador
  if (!tbl_('admins').rows.length) {
    tbl_('admins').rows.push({ cpf: cpf, name: NOME_ADMIN_INICIAL });
    sujar_('admins');
    gravarTudo_();
    quem = { role: 'admin', cpf: cpf, name: NOME_ADMIN_INICIAL };
  } else {
    const adm = tbl_('admins').rows.find(a => a.cpf === cpf);
    if (adm) {
      const senha = PropertiesService.getScriptProperties().getProperty('SENHA_ADMIN');
      if (senha) {
        if (!req.pass) return { ok: false, needPass: true, err: 'Informe a senha do administrador.' };
        if (!igual_(req.pass, senha)) {
          const n = Number(cache.get('f_' + cpf) || 0) + 1;
          cache.put('f_' + cpf, String(n), 900);
          if (n >= MAX_TENTATIVAS) cache.put('bloq_' + cpf, '1', 900);
          Utilities.sleep(800);
          falha_('Senha incorreta.');
        }
        cache.remove('f_' + cpf);
      }
      quem = { role: 'admin', cpf: cpf, name: adm.name || 'Administrador' };
    } else {
      const k = tbl_('coords').rows.find(x => x.cpf === cpf);
      if (!k) { Utilities.sleep(800); falha_('CPF não cadastrado. Procure a Secretaria de Educação.'); }
      const sids = k.sids.filter(id => tbl_('schools').rows.some(e => e.id === id));
      if (!sids.length) falha_('Nenhuma escola vinculada a este CPF.');
      quem = { role: 'coord', cpf: cpf, name: k.name, sids: sids };
    }
  }
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('s_' + token, JSON.stringify({ role: quem.role, cpf: cpf }), SESSAO_SEGUNDOS);
  return { ok: true, token: token, role: quem.role, name: quem.name, data: dados_(quem) };
}

function sair_(req) {
  if (req.token) CacheService.getScriptCache().remove('s_' + req.token);
  return { ok: true };
}

function carregar_(req) {
  const q = sessao_(req.token);
  return { ok: true, role: q.role, name: q.name, data: dados_(q) };
}

/* ================= DADOS ENVIADOS AO SITE ================= */
function mapaRec_(filtro) {
  const rec = {};
  tbl_('recs').rows.forEach(r => { if (filtro && !filtro(r)) return; (rec[r.aid] = rec[r.aid] || {})[r.pid] = [r.w, r.r]; });
  return rec;
}
function dados_(q) {
  const cur = anoVigente_();
  const base = { levels: tbl_('levels').rows.map(x => ({ id: x.id, name: x.name })), cur: cur };
  if (q.role === 'admin') {
    return Object.assign(base, { years: tbl_('years').rows, schools: tbl_('schools').rows, classes: tbl_('classes').rows,
      periods: tbl_('periods').rows, coords: tbl_('coords').rows, admins: tbl_('admins').rows.map(a => a.cpf),
      students: tbl_('students').rows, rec: mapaRec_() });
  }
  const turmas = tbl_('classes').rows.filter(c => c.yid === cur && q.sids.indexOf(c.sid) >= 0);
  const ids = {}; turmas.forEach(c => ids[c.id] = 1);
  const alunos = tbl_('students').rows.filter(s => ids[s.cid]), aid = {}; alunos.forEach(s => aid[s.id] = 1);
  return Object.assign(base, { years: tbl_('years').rows.filter(y => y.id === cur),
    schools: tbl_('schools').rows.filter(s => q.sids.indexOf(s.id) >= 0), classes: turmas,
    periods: tbl_('periods').rows.filter(p => p.yid === cur), coords: [], admins: [],
    students: alunos, rec: mapaRec_(r => aid[r.aid]) });
}

/* ================= GRAVAÇÃO (com trava) ================= */
function gravar_(req) {
  const trava = LockService.getScriptLock();
  try { trava.waitLock(25000); } catch (e) { falha_('O sistema está ocupado. Tente novamente em instantes.'); }
  try {
    _DB = {};
    const quem = sessao_(req.token);
    const ops = req.ops;
    if (!Array.isArray(ops) || ops.length > 3000) falha_('Pedido inválido.');
    const ctx = { q: quem, cur: anoVigente_() };
    ops.forEach(op => aplicar_(ctx, op));
    if (ctx.cur !== anoVigente_()) definirVigente_(ctx.cur);
    gravarTudo_();
    return { ok: true };
  } finally {
    trava.releaseLock();
  }
}

function aplicar_(ctx, op) {
  if (!op || typeof op.t !== 'string') falha_('Pedido inválido.');
  if (op.t === 'rec') return opRec_(ctx, op);
  if (op.t === 'stu') return opStu_(ctx, op);
  if (ctx.q.role !== 'admin') falha_('Você não tem permissão para esta operação.');
  if (op.t === 'put') return opPut_(ctx, op);
  if (op.t === 'del') return opDel_(ctx, op);
  if (op.t === 'recdel') return removerRecs_(r => r.cid === op.cid && r.pid === op.pid);
  if (op.t === 'cur') {
    if (!tbl_('years').rows.some(y => y.id === op.id)) falha_('Ano letivo não encontrado.');
    ctx.cur = op.id; return;
  }
  falha_('Operação desconhecida.');
}

function removerRecs_(fn) {
  const t = tbl_('recs'), n = t.rows.length;
  t.rows = t.rows.filter(r => !fn(r));
  if (t.rows.length !== n) t.dirty = true;
}

function limpar_(k, o) {
  if (!o || typeof o !== 'object') falha_('Pedido inválido.');
  const r = {};
  SPEC[k].f.forEach(c => {
    const key = c[1], t = c[2], v = o[key];
    if (t === 'n') r[key] = Math.max(0, Math.floor(Number(v) || 0));
    else if (t === 'b') r[key] = !!v;
    else if (t === 'c') r[key] = cpfNorm_(v);
    else if (t === 'l') {
      if (!Array.isArray(v) || !v.every(idOk_)) falha_('Lista inválida.');
      r[key] = v.slice();
    } else {
      r[key] = String(v == null ? '' : v).trim().slice(0, 300);
      if (/(^|_)id$|^(yid|sid|lid)$/.test(key) && !idOk_(r[key])) falha_('Identificador inválido.');
    }
  });
  return r;
}

function opPut_(ctx, op) {
  if (EDITAVEIS.indexOf(op.k) < 0) falha_('Operação desconhecida.');
  const k = op.k, o = limpar_(k, op.o), chave = (k === 'coords' || k === 'admins') ? 'cpf' : 'id', t = tbl_(k);
  if (!o[chave]) falha_('Cadastro sem identificação.');
  if (op.n && t.rows.some(x => x[chave] === o[chave]))
    falha_((k === 'coords' || k === 'admins') ? 'Este CPF já está cadastrado.' : 'Este cadastro já existe.');
  const outro = x => x[chave] !== o[chave];
  const nomeIgual = x => x.name && o.name && x.name.toLowerCase() === o.name.toLowerCase();

  if (k === 'years') {
    if (!o.name) falha_('Informe o nome do ano letivo.');
    if (t.rows.some(x => outro(x) && nomeIgual(x))) falha_('Já existe um ano letivo com esse nome.');
  }
  if (k === 'levels') {
    if (!o.name) falha_('Informe o nome da etapa.');
    if (t.rows.some(x => outro(x) && nomeIgual(x))) falha_('Já existe uma etapa com esse nome.');
  }
  if (k === 'schools') {
    if (!o.name) falha_('Informe o nome da escola.');
    if (!o.lids.length) falha_('Marque ao menos uma etapa para a escola.');
    const ets = tbl_('levels').rows;
    if (!o.lids.every(l => ets.some(e => e.id === l))) falha_('Etapa não encontrada.');
    if (tbl_('classes').rows.some(c => c.sid === o.id && c.lid !== 'multi' && o.lids.indexOf(c.lid) < 0))
      falha_('Esta escola tem turmas nessa etapa. Exclua as turmas antes de desvincular.');
  }
  if (k === 'classes') {
    if (!o.name) falha_('Informe o nome da turma.');
    if (!tbl_('years').rows.some(y => y.id === o.yid)) falha_('Ano letivo não encontrado.');
    const esc = tbl_('schools').rows.find(s => s.id === o.sid);
    if (!esc) falha_('Escola não encontrada.');
    if (o.lid !== 'multi' && esc.lids.indexOf(o.lid) < 0) falha_('A escola não oferece a etapa escolhida.');
  }
  if (k === 'periods') {
    if (!o.name) falha_('Informe o nome do período.');
    if (!tbl_('years').rows.some(y => y.id === o.yid)) falha_('Ano letivo não encontrado.');
  }
  if (k === 'inds' && !o.text) falha_('Informe a descrição do indicador.');
  if (k === 'coords') {
    if (!o.name || o.cpf.length !== 11 || !o.sids.length) falha_('Informe nome, CPF completo e ao menos uma escola.');
    if (!cpfValido_(o.cpf)) falha_('CPF inválido. Confira os números.');
    if (tbl_('admins').rows.some(a => a.cpf === o.cpf)) falha_('Este CPF já pertence a outro usuário.');
    const esc = tbl_('schools').rows;
    if (!o.sids.every(s => esc.some(e => e.id === s))) falha_('Escola não encontrada.');
  }
  if (k === 'admins') {
    if (!o.name || o.cpf.length !== 11) falha_('Informe nome e CPF completo.');
    if (!cpfValido_(o.cpf)) falha_('CPF inválido. Confira os números.');
    if (tbl_('coords').rows.some(c => c.cpf === o.cpf)) falha_('Este CPF já pertence a um coordenador.');
  }

  const i = t.rows.findIndex(x => x[chave] === o[chave]);
  if (i >= 0) t.rows[i] = o; else t.rows.push(o);
  if (k === 'levels' || k === 'inds') t.rows.sort((a, b) => a.ord - b.ord);
  t.dirty = true;
}

function opDel_(ctx, op) {
  if (EDITAVEIS.indexOf(op.k) < 0) falha_('Operação desconhecida.');
  const k = op.k, id = String(op.id), chave = (k === 'coords' || k === 'admins') ? 'cpf' : 'id', t = tbl_(k);
  if (!t.rows.some(x => x[chave] === id)) return;
  const tirar = (nome, fn) => { const tt = tbl_(nome), n = tt.rows.length; tt.rows = tt.rows.filter(x => !fn(x)); if (tt.rows.length !== n) tt.dirty = true; };

  if (k === 'years') {
    if (t.rows.length < 2) falha_('É preciso manter ao menos um ano letivo.');
    if (ctx.cur === id) falha_('Defina outro ano como vigente antes de excluir este.');
    const cs = {}; tbl_('classes').rows.filter(c => c.yid === id).forEach(c => cs[c.id] = 1);
    const ps = {}; tbl_('periods').rows.filter(p => p.yid === id).forEach(p => ps[p.id] = 1);
    removerRecs_(r => cs[r.cid] || ps[r.pid]); tirar('students', s => cs[s.cid]);
    tirar('classes', c => c.yid === id); tirar('periods', p => p.yid === id);
  }
  if (k === 'levels') {
    if (tbl_('classes').rows.some(c => c.lid === id)) falha_('Há turmas nessa etapa. Exclua as turmas antes de excluir a etapa.');
    tbl_('schools').rows.forEach(s => { if (s.lids.indexOf(id) >= 0) { s.lids = s.lids.filter(x => x !== id); tbl_('schools').dirty = true; } });
  }
  if (k === 'schools') {
    const cs = {}; tbl_('classes').rows.filter(c => c.sid === id).forEach(c => cs[c.id] = 1);
    removerRecs_(r => cs[r.cid]); tirar('students', s => cs[s.cid]); tirar('classes', c => c.sid === id);
    tbl_('coords').rows.forEach(c => { if (c.sids.indexOf(id) >= 0) { c.sids = c.sids.filter(x => x !== id); tbl_('coords').dirty = true; } });
  }
  if (k === 'classes') { removerRecs_(r => r.cid === id); tirar('students', s => s.cid === id); }
  if (k === 'periods') removerRecs_(r => r.pid === id);
  if (k === 'inds') removerRecs_(r => r.iid === id);
  if (k === 'admins') {
    if (t.rows.length < 2) falha_('É preciso manter ao menos um administrador.');
  }
  tirar(k, x => x[chave] === id);
}

function opStu_(ctx, op) {
  const q = ctx.q, c = tbl_('classes').rows.find(x => x.id === op.cid);
  if (!c) falha_('Turma não encontrada.');
  if (q.role !== 'admin') {
    if (q.sids.indexOf(c.sid) < 0) falha_('Você não tem permissão para esta turma.');
    if (c.yid !== ctx.cur) falha_('Este ano letivo não está mais vigente.');
  }
  if (!Array.isArray(op.list) || op.list.length > 80) falha_('Lista de alunos inválida (máximo 80 por turma).');
  const t = tbl_('students'), vistos = {};
  const nova = op.list.map(a => {
    const id = String(a && a.id), nome = String(a && a.name || '').trim().slice(0, 120);
    if (!idOk_(id) || vistos[id]) falha_('Aluno com identificação inválida.');
    if (!nome) falha_('Há aluno sem nome na lista.');
    if (t.rows.some(s => s.id === id && s.cid !== c.id)) falha_('Aluno já pertence a outra turma.');
    const lid = String(a && a.lid || '').trim();
    vistos[id] = 1; return { id: id, cid: c.id, name: nome, lid: lid };
  });
  removerRecs_(r => r.cid === c.id && !vistos[r.aid]);
  t.rows = t.rows.filter(s => s.cid !== c.id).concat(nova); t.dirty = true;
}

function opRec_(ctx, op) {
  const q = ctx.q;
  const c = tbl_('classes').rows.find(x => x.id === op.cid), p = tbl_('periods').rows.find(x => x.id === op.pid);
  if (!c || !p) falha_('Turma ou período não encontrado.');
  if (p.yid !== c.yid) falha_('Período e turma são de anos letivos diferentes.');
  if (q.role !== 'admin') {
    if (q.sids.indexOf(c.sid) < 0) falha_('Você não tem permissão para esta turma.');
    if (c.yid !== ctx.cur) falha_('Este ano letivo não está mais vigente.');
    if (!p.open) falha_('Este período está fechado para preenchimento.');
  }
  const r = op.r || {}, alunos = {}, novas = [];
  tbl_('students').rows.forEach(s => { if (s.cid === c.id) alunos[s.id] = 1; });
  const tz = Session.getScriptTimeZone() || 'America/Maceio';
  const agora = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  Object.keys(r).forEach(aid => {
    if (!alunos[aid]) falha_('Aluno não pertence a esta turma.');
    const w = String(r[aid][0] || ''), l = String(r[aid][1] || '');
    if (w && NIVEIS_ESCRITA.indexOf(w) < 0) falha_('Nível de escrita inválido.');
    if (l && NIVEIS_LEITURA.indexOf(l) < 0) falha_('Nível de leitura inválido.');
    if (w || l) novas.push({ aid: aid, cid: c.id, pid: p.id, w: w, r: l, at: agora, by: q.name });
  });
  removerRecs_(x => x.cid === c.id && x.pid === p.id);
  const t = tbl_('recs'); novas.forEach(x => t.rows.push(x)); t.dirty = true;
}

/* ================= CONFIGURAÇÃO INICIAL ================= */
function criarAbas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return;
  Object.keys(SPEC).forEach(nome => {
    const s = SPEC[nome], sh = ss.getSheetByName(s.sheet) || ss.insertSheet(s.sheet);
    if (sh.getMaxColumns() < s.f.length) sh.insertColumnsAfter(sh.getMaxColumns(), s.f.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, s.f.length).setValues([s.f.map(c => c[0])]).setFontWeight('bold').setBackground('#E4F2EA');
    sh.setFrozenRows(1);
  });
}
function semear_() {
  if (!tbl_('levels').rows.length) { tbl_('levels').rows = ANOS_PADRAO.map((n, i) => ({ id: 'l' + (i + 1), name: n, ord: i })); sujar_('levels'); }
  if (!tbl_('years').rows.length) { tbl_('years').rows.push({ id: 'y1', name: String(new Date().getFullYear()) }); sujar_('years'); }
  if (!tbl_('cfg').rows.some(r => r.k === 'ano_vigente')) definirVigente_(anoVigente_());
}
function garantirInicializacao_() {
  criarAbas_(); semear_(); gravarTudo_();
}
function configurarPlanilha() {
  _DB = {}; criarAbas_(); semear_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ['Planilha1', 'Sheet1'].forEach(n => { const x = ss.getSheetByName(n); if (x && x.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(x); });
  const adm = cpfNorm_(ADMIN_INICIAL);
  if (cpfValido_(adm) && !tbl_('admins').rows.some(a => a.cpf === adm)) { tbl_('admins').rows.push({ cpf: adm, name: NOME_ADMIN_INICIAL }); sujar_('admins'); }
  gravarTudo_();
  Logger.log('Planilha configurada com sucesso!');
}

/* Escolas e turmas de exemplo (inspiradas na planilha de diagnóstico) com alunos e níveis sorteados */
function carregarDadosDeExemplo() {
  _DB = {}; garantirInicializacao_();
  const y = anoVigente_(), lv = tbl_('levels').rows.map(l => l.id), lids = lv;
  if (!tbl_('schools').rows.length) {
    tbl_('schools').rows = [{ id: 'e1', name: 'ESCOLA DEP. MANOEL PEREIRA FILHO', lids: lids }, { id: 'e2', name: 'ESCOLA DEP. JOSÉ LÚCIO DE MELO', lids: lids }, { id: 'e3', name: 'ESCOLA NOSSA SENHORA APARECIDA', lids: lids }];
    sujar_('schools');
  }
  if (!tbl_('periods').rows.length) {
    tbl_('periods').rows = [1, 2, 3, 4].map(n => ({ id: 'p' + n, yid: y, name: n + 'º Bimestre', open: n === 3 }));
    sujar_('periods');
  }
  if (!tbl_('classes').rows.length) {
    const T = [['e1', '1º A', 'l1', 'Andressa', 'Matutino'], ['e1', '2º A', 'l2', 'Marta', 'Vespertino'], ['e1', '3º A', 'l3', 'Iris', 'Matutino'], ['e2', '2º A', 'l2', 'M. Edjane', 'Matutino'], ['e3', '1º A', 'l1', 'Maiara', 'Vespertino']];
    tbl_('classes').rows = T.map((t, i) => ({ id: 'c' + (i + 1), yid: y, sid: t[0], name: t[1], lid: t[2], prof: t[3], shift: t[4] || 'Matutino' })); sujar_('classes');
    const pr = Math.random, sorteio = (a, ate) => a[Math.min(a.length - 1, Math.floor(pr() * (ate || a.length)))];
    tbl_('classes').rows.forEach(c => {
      const serie = Number(c.lid.slice(1));
      for (let i = 1; i <= 12; i++) {
        const aid = c.id + 'a' + i;
        tbl_('students').rows.push({ id: aid, cid: c.id, name: 'Aluno ' + (i < 10 ? '0' : '') + i + ' (' + c.name + ')' });
        const w = sorteio(NIVEIS_ESCRITA, 2 + serie), r = sorteio(NIVEIS_LEITURA, 2 + serie);
        tbl_('recs').rows.push({ aid: aid, cid: c.id, pid: 'p3', w: w, r: r, at: '', by: 'Exemplo' });
      }
    });
    sujar_('students'); sujar_('recs');
  }
  if (!tbl_('coords').rows.length) {
    tbl_('coords').rows = [{ cpf: '52998224725', name: 'Coordenadora Ana', sids: ['e1', 'e2'] }, { cpf: '11144477735', name: 'Coordenador Carlos', sids: ['e3'] }];
    sujar_('coords');
  }
  gravarTudo_();
  Logger.log('Dados de exemplo inseridos com sucesso.');
}
