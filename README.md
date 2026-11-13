# Monitoramento do Ensino Fundamental · Anos Iniciais · Lagoa da Canoa

Sistema web interativo para acompanhamento e registro do desenvolvimento e aprendizagem no Ensino Fundamental (anos iniciais, 1º ao 5º ano) do Município de Lagoa da Canoa - AL.

O sistema opera com frontend estático (SPA) hospedado no **GitHub Pages** e backend serverless no **Google Sheets** integrado via **Google Apps Script**.

---

## 🚀 Acesso ao Sistema (GitHub Pages)

- **URL do Aplicativo:** `https://douglas14031999.github.io/monitoramento-ensino-fundamental-1/`
- **Página principal:** `index.html`

---

## 🛠️ Arquitetura e Tecnologias

- **Frontend:**
  - HTML5, CSS3 moderno com suporte a modo claro/escuro (`prefers-color-scheme`).
  - JavaScript Vanilla sem dependências pesadas externas.
  - Tipografia: Google Fonts (*Plus Jakarta Sans*).
  - Ícones e logomarca oficial de Lagoa da Canoa embutidos em base64.
- **Backend / Banco de Dados:**
  - Google Sheets (planilha institucional da Secretaria de Educação).
  - Google Apps Script exposto como Web App (`doGet` e `doPost`).
  - Cache de sessão e proteção contra força bruta por CPF.
  - Autenticação e validação de dígitos verificadores de CPF no cliente e no servidor.

---

## ⚙️ Configuração e Implantação

### 1. Planilha e Apps Script (Backend)
1. Crie uma nova planilha no Google Sheets na conta institucional da Secretaria.
2. Acesse **Extensões > Apps Script**.
3. Cole o conteúdo de [`Codigo.gs`](./Codigo.gs).
4. Edite a constante `ADMIN_INICIAL` com o CPF válido do administrador.
5. Selecione a função `configurarPlanilha` e clique em **Executar** (autorize as permissões solicitadas pelo Google).
   - *(Opcional)*: Para carregar turmas e indicadores padrão de demonstração, execute `carregarDadosDeExemplo`.
6. Vá em **Implantar > Nova implantação > Tipo: App da Web**:
   - **Executar como:** *Eu (seu e-mail)*
   - **Quem tem acesso:** *Qualquer pessoa*
7. Copie a URL gerada terminada em `/exec`.

### 2. Configuração do Frontend
A URL do Web App gerada é definida na constante `API_URL` dentro de [`index.html`](./index.html):

```javascript
const API_URL = "COLE_AQUI_A_URL_DO_APPS_SCRIPT/exec";
```

### 3. Ativar o GitHub Pages
1. No repositório do GitHub, vá em **Settings** (Configurações).
2. Na barra lateral esquerda, clique em **Pages**.
3. Em **Build and deployment > Source**, selecione **Deploy from a branch**.
4. Em **Branch**, selecione `main` e a pasta `/ (root)`.
5. Clique em **Save**. Em instantes, o site estará publicado e acessível publicamente com HTTPS.

---

## 🔒 Segurança e Privacidade

- **Proteção de CPFs:** A planilha de banco de dados deve permanecer restrita apenas ao administrador e à conta do Apps Script.
- **Requisições sem Preflight:** As chamadas de API utilizam `Content-Type: text/plain;charset=utf-8` para compatibilidade total com o CORS do Google Apps Script sem bloqueios de preflight.
- **Sessões Persistentes e Seguras:** Os tokens de sessão são mantidos com segurança em armazenamento local (`localStorage`), mantendo o usuário conectado mesmo ao fechar ou atualizar o navegador, com renovação automática de TTL no Apps Script e expiração manual via botão "Sair".
- **Sincronização em Tempo Real:** Atualizações periódicas automáticas a cada 20 segundos e ao alternar abas, com pausa inteligente para não sobrepor preenchimento de formulários em andamento.
- **Identidade Visual e Favicon:** Brasão e identidade oficial de Lagoa da Canoa incluídos em alta resolução e configurados como favicon nativo (`.ico`, `.png` e inline).


---

## 📚 Como funciona o Fundamental I

- **Abas da planilha** (criadas por `configurarPlanilha`): Anos, Anos_Escolares (1º–5º), Escolas, Turmas (com professor), **Alunos**, Periodos (bimestres), **Avaliacoes** (1 linha por aluno/período com nível de escrita e de leitura), Coordenadores, Admins, Config.
- **Escrita:** Pré-silábico · Silábico s/ valor · Silábico c/ valor · Silábico alfabético · Alfabético · Ortográfico.
- **Leitura:** Pré-leitor nível 1 a 4 · Leitor iniciante · Leitor fluente.
- **Coordenador:** escolhe escola → período → turma → lista de alunos, marcando escrita e leitura de cada um. Os totais por nível (iguais à planilha antiga) são calculados automaticamente.
- **Secretaria:** abas Resumo, **Diagnóstico** (tabela no modelo da planilha, imprimível em A4 paisagem) e cadastros.
