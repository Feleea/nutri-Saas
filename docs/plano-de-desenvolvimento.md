# Suas Nutri — Plano de Desenvolvimento do SaaS

Versão 1.1 · 24/10/2026 · Documento vivo: atualize a cada fase concluída

> **Andamento:** a seção 15 resume o que já foi implementado, as decisões tomadas, as pendências para fechar o gate G0 e o plano revisado. As histórias das seções 9 e 10 trazem marcas de situação (legenda na seção 15.1).

## 1. Visão geral e princípios

O Suas Nutri é um SaaS multi-tenant para nutricionistas, com dois públicos distintos:

- **Nutricionista clínico:** atende pacientes de todos os perfis (consultório, clínica, teleatendimento).
- **Nutricionista de produção e qualidade (UAN):** controla produção, higiene, rastreabilidade e conformidade em cozinhas, restaurantes, escolas, hospitais e indústrias.

Cada nutricionista (ou clínica) é um **tenant**. Você, dono da plataforma, é o **super-admin**: enxerga a conta e o consumo de cada nutricionista, mas jamais o conteúdo clínico dos pacientes.

**Princípios que guiam todas as decisões:**

- **Privacidade por design:** dados de pacientes só são visíveis ao nutricionista responsável e à equipe que ele autorizar.
- **Clínico primeiro:** mercado maior e validação mais rápida. Produção entra depois, como módulo próprio.
- **Módulos vendáveis separadamente:** Clínico, Produção/Qualidade e Combo.
- **Cálculo nutricional é o coração do produto:** precisão, fonte e versão sempre rastreáveis.
- **Testes automatizados desde o dia 1:** principalmente isolamento entre tenants e cálculos nutricionais.

## 2. Decisões de arquitetura

Essas decisões são caras de mudar depois. Tome-as antes da primeira tela.

**Hierarquia de entidades**

- Conta (cobrança) → Unidade (consultório, filial, cozinha) → Profissional/Usuário → Paciente.
- Dica: mesmo que o MVP tenha só nutricionistas autônomos, modele já “Conta” e “Unidade”. Clínicas e redes de cozinhas vão aparecer, e migrar o modelo com clientes ativos é doloroso.

**Isolamento de dados entre tenants**

- Toda tabela de negócio carrega o identificador do tenant.
- Insight: no PostgreSQL, Row Level Security (RLS) garante o isolamento no próprio banco, mesmo que haja um bug na aplicação. É suficiente e barato para começar. Banco ou schema dedicado por tenant só vale para clientes enterprise que exijam isso em contrato.

**Separação entre dados clínicos e dados de gestão**

- O painel do dono nunca consulta tabelas clínicas. Ele lê apenas tabelas de conta, cobrança e contadores de uso.
- Dica: use um usuário de banco distinto para o painel admin, com permissão somente nessas tabelas e views agregadas. Assim, a privacidade deixa de depender só de “regras no código”.

**Segurança**

- Criptografia em trânsito (TLS) e em repouso; campos mais sensíveis (anamnese, exames, notas de consulta) com criptografia na aplicação e chaves por tenant.
- Controle de acesso por papéis: Titular, Profissional, Secretaria, Paciente e Super-admin.
- Log de auditoria imutável de todo acesso a dados de paciente.
- Backups automáticos, testados periodicamente (um backup que nunca foi restaurado não é backup).

**Stack sugerida (flexível)**

- Front-end web responsivo (React/Next.js), API (Node/NestJS ou Python/Django), PostgreSQL, Redis para filas e cache, armazenamento de arquivos compatível com S3.
- Dica: priorize o que sua equipe já domina. A stack importa menos do que o isolamento de dados e a qualidade dos cálculos.

**LGPD**

- Dados de saúde são dados pessoais sensíveis. O nutricionista é o controlador; a sua plataforma é a operadora.
- Inclua nos termos de uso um contrato de tratamento de dados (DPA), política de privacidade, termo de consentimento do paciente e fluxo de exportação e exclusão dos dados.
- Valide a redação final com um advogado especializado em proteção de dados.

## 3. Modelo de cobrança

**Cobrança por quantidade de pacientes (módulo Clínico)**

- Planos em faixas, por exemplo: até 30 pacientes, até 100, até 300 e acima sob consulta. Os valores devem sair de pesquisa com nutricionistas e análise de concorrentes.
- Defina com clareza o que é “paciente ativo”: por exemplo, quem teve consulta, plano ou interação nos últimos 90 dias. Cobrar por ativos é mais justo e reduz cancelamentos; cobrar por cadastrados é mais simples e previsível. Escolha uma regra e comunique de forma transparente.
- Dica: nunca bloqueie o acesso do nutricionista aos dados dos próprios pacientes por inadimplência ou excesso de limite. Use aviso aos 80% do limite, período de carência e bloqueio apenas de novos cadastros.

**Cobrança do módulo Produção/Qualidade**

- Cozinhas e UAN não têm “pacientes”. Cobre por unidade (cozinha) ou por número de usuários.
- O Combo (clínico + produção) atrai nutricionistas que fazem os dois trabalhos e aumenta o ticket médio.

**Operação de cobrança**

- Trial de 14 dias sem cartão; upgrade e downgrade automáticos; cupons e plano anual com desconto.
- Insight: no Brasil, Pix e boleto são essenciais. Gateways como Asaas, Iugu e Pagar.me resolvem recorrência, Pix, boleto e emissão de nota fiscal. Compare taxas e integrações antes de escolher.

## 4. Roadmap por fases

As estimativas abaixo assumem uma equipe pequena (2 a 3 pessoas de desenvolvimento) e servem como ponto de partida para planejamento, não como compromisso.

### Fase 0 — Fundação (4 a 6 semanas)

> **Situação (24/10/2026):** código e testes escritos para quase todo o escopo; falta validar em ambiente real e cumprir os critérios do gate G0 (seção 15.6).

**Autenticação e contas**

- Cadastro, login, recuperação de senha, 2FA opcional (TOTP), convite de membros da equipe.
- Insight: destaque o 2FA e a criptografia no marketing. Nutricionistas lidam com dados sensíveis e valorizam isso.

**Planos, assinatura e limites**

- Cadastro de planos com limites (pacientes, usuários, armazenamento) e integração com o gateway.
- Dica: construa os limites como configuração, não como código fixo. Você vai mudar faixas e preços várias vezes.

**Base de alimentos**

- Importe TACO e TBCA, permita alimentos e receitas próprios e produtos industrializados (rótulo).
- Dica: guarde fonte e versão de cada valor nutricional e deixe o nutricionista escolher a tabela de referência. Confirme as condições de uso de cada tabela antes de publicar.

**Painel do dono — versão 0**

- Lista de tenants com plano, status e contagem de pacientes (detalhes na seção 5).
- Insight: criar o painel já na Fase 0 obriga a separar dados de gestão e dados clínicos desde o início.

**Esteira de qualidade**

- Ambientes (dev, staging, produção), CI/CD, testes automatizados rodando a cada PR e monitoramento de erros.

### Fase 1 — MVP clínico (8 a 12 semanas)

> **Situação (24/10/2026):** em andamento. Pacientes, consentimento LGPD, limites de plano e agenda com lembretes estão implementados. Faltam anamnese e antropometria, plano alimentar, financeiro básico e painel do dono v1.

**1. Pacientes**

- Cadastro, histórico, anexos (exames, fotos), tags e busca.
- Dica: mantenha o cadastro enxuto no primeiro contato (nome, contato, objetivo). Campos demais afastam quem está testando.
- Insight: ofereça importação por planilha. A principal barreira para trocar de sistema é migrar a base de pacientes.

**2. Agenda**

- Consultas, retornos, bloqueios, lembretes por e-mail e WhatsApp, link de teleconsulta.
- Dica: lembrete automático reduz faltas e é um dos recursos que o nutricionista percebe valor mais rápido. O WhatsApp oficial tem custo e regras; comece com e-mail e link para abrir conversa, e evolua depois.

**3. Anamnese e avaliação**

- Modelos de anamnese customizáveis, antropometria, IMC, bioimpedância, dobras cutâneas, gráficos de evolução.
- Insight: permita que o nutricionista monte e salve os próprios formulários. Cada profissional tem o seu método, e isso vira fidelização.

**4. Plano alimentar**

- Montagem por refeição, cálculo automático de calorias, macros e micronutrientes, lista de substituições, exportação em PDF com a marca do profissional.
- Insight: é a funcionalidade mais usada e a que mais decide a compra. Invista em velocidade (busca de alimentos instantânea) e em um PDF bonito.
- Dica: cubra o cálculo com testes de valores de referência. Um erro nutricional destrói a confiança no produto.

**5. Financeiro básico**

- Registro de consultas e pacotes, cobranças e recebimentos, status de pagamento.
- Dica: simples basta nesta fase. O objetivo é substituir a planilha do nutricionista, não competir com um ERP.

**Painel do dono — versão 1**

- Métricas de receita e uso, gestão de planos e limites, cobrança dos tenants.

### Fase 2 — Clínico avançado e engajamento (6 a 10 semanas)

> **Situação (24/10/2026):** não iniciada.

**Portal e app do paciente**

- Acesso ao plano alimentar, metas, agendamentos e diário alimentar com fotos.
- Insight: o paciente engajado volta mais às consultas, e isso é argumento de venda para o nutricionista. Também aumenta a necessidade de segurança e consentimento, então reforce o fluxo de LGPD.

**Mensagens e acompanhamento**

- Chat entre nutricionista e paciente, lembretes de hidratação, metas e check-ins.
- Dica: ofereça o chat dentro da plataforma para manter o histórico e os dados sob controle do nutricionista.

**Protocolos e modelos reutilizáveis**

- Planos-modelo por perfil (emagrecimento, gestante, esportista, patologias).
- Insight: modelos economizam tempo e viram um diferencial. Considere permitir que o nutricionista duplique e adapte os próprios modelos.

**Prescrição de suplementos e exames**

- Cadastro de suplementos, solicitação de exames, comparação de resultados ao longo do tempo.

**Necessidades nutricionais**

- Fórmulas de TMB e GET (Harris-Benedict, Mifflin, FAO/OMS, entre outras), com escolha da fórmula pelo profissional.
- Dica: exiba qual fórmula foi usada em cada plano. Isso dá transparência e respaldo ao profissional.

### Fase 3 — Produção e qualidade (10 a 14 semanas)

> **Situação (24/10/2026):** não iniciada.

Esse módulo atende nutricionistas responsáveis técnicos por cozinhas e UAN. Ele funciona como um segundo produto: pesquise com pelo menos 5 desses profissionais antes de começar.

**1. Fichas técnicas de preparação**

- Ingredientes, per capita, rendimento, fator de correção e de cocção, custo por porção, modo de preparo, valor nutricional.
- Insight: a ficha técnica é a base de tudo (cardápio, compras, custo, rastreabilidade). Faça-a primeiro e bem.

**2. Cardápios institucionais**

- Ciclos de cardápio, per capita por público (escolar, hospitalar, industrial), análise nutricional por refeição.
- Dica: contratos como o PNAE e outros programas têm exigências próprias de cardápio. Pergunte aos clientes-alvo quais regras eles seguem e permita configurá-las.

**3. Planejamento de produção**

- Quantidades por dia, lista de compras, requisições ao estoque, previsão de sobras.

**4. Estoque e fornecedores**

- Entradas, validade, lotes, inventário, avaliação e homologação de fornecedores.
- Dica: leitura de código de barras pelo celular acelera muito o recebimento de mercadorias.

**5. Checklists de boas práticas**

- Checklists configuráveis (recebimento, higiene, instalações, manipuladores), com foto, assinatura e pontuação de conformidade.
- Insight: baseie os modelos iniciais na RDC 216/2004 da Anvisa e permita adaptar às normas estaduais e municipais (por exemplo, a Portaria CVS 5/2013 em São Paulo). Revise a aderência com um profissional da área.

**6. Controles diários**

- Temperaturas (recebimento, câmaras, estufas, distribuição), higienização, controle de óleo, coleta de amostras.
- Dica: o preenchimento precisa ser rápido e funcionar no celular, até offline. Se der trabalho demais, a equipe da cozinha não usa.

**7. Não conformidades e planos de ação**

- Abertura automática a partir de um item reprovado, responsável, prazo, evidências, verificação de eficácia.
- Insight: esse ciclo (detectar, corrigir, verificar) é exatamente o que auditores e a vigilância sanitária querem ver.

**8. Documentos**

- POPs, Manual de Boas Práticas e plano APPCC, com versionamento, validade e alerta de revisão.
- Dica: ofereça modelos editáveis. Isso reduz o esforço de adoção e vira um atrativo comercial.

**9. Rastreabilidade**

- Do lote do insumo à preparação e à refeição servida, com consulta rápida em caso de ocorrência.

### Fase 4 — Diferenciais e escala

> **Situação (24/10/2026):** não iniciada. Já existem, vindos das fases anteriores: rotinas agendadas por segredo e a base do painel do dono.

- **Dashboards gerenciais:** conformidade, custo por refeição, desperdício e sobras, evolução de pacientes.
- **Relatórios de auditoria:** pacote pronto para a vigilância sanitária e para auditorias de clientes.
- **Integrações:** WhatsApp, Google Agenda, gateways, balanças e termômetros (medição automática de temperatura).
- **Assistente com IA:** sugestão de cardápio e substituições, análise do diário alimentar, resumo de consulta. Dica: a IA deve sugerir e o nutricionista decidir e assinar. Deixe isso explícito na interface e nos termos de uso.
- **App móvel com modo offline** para checklists e controles em cozinha.
- **API pública e white-label** para clínicas, redes e franquias.
- **Painel do dono — versão completa:** funcionalidades avançadas descritas na seção 5.

## 5. Painel de gestão do tenant (visão do dono)

**Objetivo:** dar a você uma visão completa de clientes, receita e uso, sem nunca expor dados de pacientes.

### O que o painel mostra

- Dados da conta do nutricionista: nome, e-mail, telefone, registro profissional (CRN), cidade, data de cadastro, último acesso.
- Plano contratado, módulos ativos, status (trial, ativo, inadimplente, suspenso, cancelado).
- **Quantidade de pacientes:** total cadastrado, ativos nos últimos 90 dias e percentual do limite do plano.
- Quantidade de usuários da equipe, armazenamento usado, volume de consultas e planos criados (somente contagens).
- Faturas, pagamentos, cupons, histórico de upgrades e downgrades.

### O que o painel nunca mostra

- Nome, documento, contato ou qualquer dado de identificação de pacientes.
- Anamneses, exames, fotos, planos alimentares, mensagens, anotações de consulta.
- Nenhum recurso de “entrar como” o nutricionista sem autorização (ver suporte, abaixo).

Insight: essa garantia é um argumento comercial forte. Publique no site: “nem nós conseguimos ver os dados dos seus pacientes”.

### Telas e funcionalidades

- **Visão geral:** KPIs de MRR, novos clientes, cancelamentos (churn), conversão de trial para pago, pacientes totais na plataforma, ticket médio por cliente.
- **Lista de tenants:** busca e filtros por plano, status, faixa de pacientes, data de cadastro e último acesso; exportação em CSV.
- **Detalhe do tenant:** dados da conta, uso, faturas, linha do tempo de eventos (cadastro, upgrade, atraso).
- **Planos e limites:** criação e edição de faixas de pacientes, módulos, preços e regras de “paciente ativo”.
- **Cobrança:** faturas, inadimplência, cupons, reenvio de cobrança, ajustes manuais com registro.
- **Uso e alertas:** tenants perto do limite (oportunidade de upgrade), inativos há muito tempo (risco de churn), com armazenamento alto, inadimplentes.
- **Ativação e suspensão:** pausar ou reativar conta, estender trial, aplicar carência.
- **Feature flags por tenant:** liberar recursos novos para um grupo piloto antes de abrir para todos.
- **Comunicação:** avisos dentro da plataforma e e-mails segmentados (por plano, faixa de uso, status).
- **Suporte:** fila de chamados com contexto da conta (plano, status, versão), sem acesso a dados clínicos.
- **Auditoria:** registro de toda ação feita pelo super-admin (quem, quando, o quê).

Insight: os alertas de uso são a parte mais lucrativa do painel. Um aviso automático “você chegou a 90% dos pacientes do seu plano” gera upgrade com pouco esforço.

### Como implementar sem expor dados

- Crie uma tabela de contadores diários por tenant (pacientes totais, pacientes ativos, usuários, armazenamento), preenchida por um job que apenas conta registros. O painel lê só essa tabela e as de cobrança.
- Papel de super-admin separado, com 2FA obrigatório, sessões curtas, reautenticação em ações sensíveis e, se possível, lista de IPs permitidos.
- Dica: se um dia precisar ajudar um cliente com um problema, ofereça um **modo suporte** opcional: o nutricionista libera um acesso temporário e limitado, com registro e dados de pacientes mascarados. Deixe isso para a Fase 4 e só se houver demanda real.
- Teste automatizado: suíte que faz login como super-admin e tenta acessar todos os endpoints clínicos, esperando sempre negação de acesso. Rode a cada PR.

### Encerramento de conta (offboarding)

- Permita ao nutricionista exportar os dados dos pacientes antes de cancelar.
- Defina prazo de retenção e depois exclusão ou anonimização.
- Dica: conselhos profissionais e a legislação podem exigir guarda de prontuários por determinado período. Consulte o CFN/CRN e o jurídico antes de fixar a regra de exclusão.

## 6. Estratégia de qualidade e testes

- **Pirâmide de testes:** muitos testes unitários (principalmente cálculos), testes de integração na API e poucos E2E (por exemplo, com Playwright) cobrindo os fluxos críticos: cadastro, criação de paciente, plano alimentar, cobrança.
- **Isolamento de tenant:** suíte que cria dois tenants e tenta ler, alterar e excluir dados de um usando credenciais do outro, em todos os endpoints. É o teste mais importante do produto.
- **Cálculos nutricionais:** conjunto de referência (golden files) com alimentos e receitas de valores conhecidos e tolerância definida; rode ao importar ou atualizar tabelas.
- **Permissões:** teste cada papel (titular, profissional, secretaria, paciente, super-admin) contra a matriz de acessos.
- **PDF e relatórios:** testes visuais para evitar que uma mudança de layout quebre o plano alimentar.
- **Dados de teste:** apenas dados sintéticos em staging. Nunca copie dados reais de pacientes para fora de produção.
- **Critérios de aceite:** escreva histórias de usuário com critérios (por exemplo, em formato Dado/Quando/Então) antes de cada fase, e use-os como base dos testes automatizados.
- **Desempenho e acessibilidade:** testes de carga em agenda e relatórios; verificação básica de acessibilidade nas telas principais.

## 7. Riscos e mitigações

- **Vazamento de dados de saúde:** isolamento via RLS, criptografia, auditoria, testes de isolamento e plano de resposta a incidentes (inclusive comunicação à ANPD e aos titulares quando aplicável).
- **Erro de cálculo nutricional:** testes de referência, exibição da fonte e da fórmula, versionamento das tabelas.
- **Escopo duplo (clínico e produção) dispersa a equipe:** entregar por fases e tratar a produção como um módulo e um produto à parte.
- **Regulamentação (LGPD, conselhos profissionais, Anvisa e normas locais):** revisão jurídica e técnica dos termos, modelos de checklist e regras de retenção.
- **Dificuldade de migração dos clientes:** importadores de planilha e suporte à migração na entrada.
- **Custos e regras do WhatsApp:** começar com e-mail e link, evoluir para integração oficial quando o retorno justificar.
- **Churn por falta de uso:** alertas no painel, onboarding guiado, modelos prontos.

## 8. Próximos passos sugeridos

> Revisado na seção 15.8.

- Entrevistar 5 a 10 nutricionistas clínicos e 3 a 5 de produção para validar prioridades e disposição de pagamento.
- Definir a regra de “paciente ativo” e as faixas de preço iniciais.
- Fechar stack e modelar o banco multi-tenant (conta, unidade, profissional, paciente, contadores de uso).
- Escrever histórias de usuário com critérios de aceite das Fases 0 e 1.
- Prototipar as telas-chave: plano alimentar, agenda e painel do dono.
- Rodar um piloto fechado com poucos nutricionistas antes do lançamento.

*Este documento é um plano de produto e não substitui orientação jurídica, regulatória ou de proteção de dados.*

## 9. Fase 1 — Histórias de usuário e critérios de aceite

> **Situação das histórias:** 🟡 implementada (código e testes automatizados escritos; ainda não executados em ambiente real) · 🔶 parcial (ver seção 15.7) · sem marca = não iniciada. Nenhuma história é considerada aceita antes de os testes rodarem no pipeline.

**Convenções**

- Formato das histórias: Como (perfil), quero (ação), para (benefício).
- Critérios no formato Dado / Quando / Então, prontos para virar cenários de teste.
- Prioridade: **P1** = essencial para o MVP; **P2** = desejável, entra se o prazo permitir.
- Tags de teste sugeridas: \[unit\] cálculo e regras, \[api\] contrato e permissões, \[e2e\] fluxo completo, \[seg\] segurança e isolamento.
- IDs das histórias (ex.: US-PAC-01) devem aparecer no nome dos testes para dar rastreabilidade entre requisito e teste.

### 9.1 Pacientes

**US-PAC-01 · Cadastrar paciente (P1)** 🟡

Como nutricionista, quero cadastrar um paciente com dados básicos, para iniciar o acompanhamento.

- Dado que estou logado, quando preencho nome e um contato (telefone ou e-mail) e salvo, então o paciente aparece na minha lista com status ativo. \[e2e\]
- Dado que deixo o nome em branco, quando salvo, então vejo erro no campo e nada é gravado. \[api\]
- Dado que já existe paciente com o mesmo CPF na minha conta, quando salvo, então o sistema avisa sobre a duplicidade e pede confirmação (CPF é opcional). \[api\]
- Dado que o paciente foi criado no meu tenant, quando outro nutricionista busca por ele, então ele não aparece e o acesso direto pelo ID retorna negado. \[seg\]
- Dado que o cadastro foi concluído, então o evento é registrado no log de auditoria com usuário e data. \[api\]

**US-PAC-02 · Buscar e filtrar pacientes (P1)** 🟡

Como nutricionista, quero encontrar um paciente rapidamente, para não perder tempo antes da consulta.

- Dado que tenho 500 pacientes, quando digito parte do nome, então a lista filtra ignorando acentos e maiúsculas, em até 1 segundo. \[api\]
- Dado que filtro por status ou tag, então apenas pacientes correspondentes são exibidos. \[e2e\]
- Dado que a busca não encontra ninguém, então vejo mensagem de lista vazia com atalho para cadastrar. \[e2e\]

**US-PAC-03 · Editar, arquivar e excluir paciente (P1)** 🟡

Como nutricionista, quero manter a lista organizada, para separar quem está em acompanhamento de quem não está.

- Dado um paciente ativo, quando eu o arquivo, então ele sai da lista padrão e o histórico é preservado. \[e2e\]
- Dado um paciente arquivado, quando o restauro, então ele volta ao status ativo com todo o histórico. \[api\]
- Dado que solicito exclusão definitiva, então o sistema exige confirmação explícita, remove os dados conforme a política de LGPD e registra o evento na auditoria. \[api\]
- Dado que o paciente foi excluído, quando consulto contadores de uso, então ele deixa de ser contado. \[api\]

**US-PAC-04 · Consentimento LGPD do paciente (P1)** 🟡

Como nutricionista, quero registrar o consentimento do paciente, para tratar seus dados de forma regular.

- Dado um paciente novo, quando registro o consentimento, então data e versão do termo ficam gravadas. \[api\]
- Dado um paciente sem consentimento registrado, então a ficha exibe um alerta visível. \[e2e\]

**US-PAC-05 · Anexar exames e fotos (P2)**

Como nutricionista, quero anexar arquivos à ficha, para centralizar o histórico.

- Dado um arquivo PDF, JPG ou PNG de até 10 MB, quando faço upload, então ele fica disponível na ficha. \[e2e\]
- Dado um arquivo de tipo ou tamanho inválido, então o upload é recusado com mensagem clara. \[api\]
- Dado um anexo, quando abro o link, então ele é servido por URL com expiração e só para usuários autorizados do tenant. \[seg\]
- Dado o upload, então o espaço usado entra na contagem de armazenamento do plano. \[api\]

**US-PAC-06 · Importar pacientes por planilha (P2)**

Como nutricionista, quero importar meus pacientes atuais, para migrar sem digitar tudo de novo.

- Dado o modelo de planilha, quando envio um arquivo, então vejo uma prévia com os erros por linha antes de confirmar. \[e2e\]
- Dado linhas inválidas, então as válidas podem ser importadas e as inválidas ficam em um relatório para baixar. \[api\]
- Dado que a importação ultrapassaria o limite do plano, então ela é recusada ou parcial, com aviso claro. \[api\]

### 9.2 Agenda

**US-AGE-01 · Agendar consulta (P1)** 🟡

Como nutricionista, quero marcar consultas na agenda, para organizar meus atendimentos.

- Dado um horário livre, quando agendo para um paciente, então a consulta aparece na agenda no fuso horário configurado na conta. \[e2e\]
- Dado um horário que conflita com outra consulta, então o sistema avisa e pede confirmação. \[api\]
- Dado que defini duração padrão, então novas consultas já nascem com ela e eu posso ajustar. \[e2e\]

**US-AGE-02 · Reagendar e cancelar (P1)** 🟡

Como nutricionista, quero alterar ou cancelar consultas, para refletir a realidade da agenda.

- Dado uma consulta marcada, quando reagendo, então a data muda e o histórico guarda a data anterior. \[api\]
- Dado que cancelo, então informo o motivo e a consulta fica com status cancelada, sem sumir do histórico. \[api\]
- Dado que a consulta tinha lembrete pendente, quando cancelo ou reagendo, então o lembrete antigo não é enviado. \[api\]

**US-AGE-03 · Lembretes automáticos (P1)** 🟡

Como nutricionista, quero que o paciente receba lembretes, para reduzir faltas.

- Dado uma consulta com paciente com e-mail, então um lembrete é enviado no prazo configurado (por exemplo, 24 horas antes), uma única vez. \[api\]
- Dado um paciente sem e-mail, então o sistema indica na consulta que o lembrete não pôde ser enviado. \[e2e\]
- Dado que o paciente pediu para não receber lembretes, então nenhum envio é feito. \[api\]
- Dado uma falha de envio, então o sistema tenta novamente e registra o resultado. \[api\]

**US-AGE-04 · Horários de atendimento e bloqueios (P2)**

Como nutricionista, quero definir quando atendo, para evitar marcações indevidas.

- Dado que defini dias e horários de atendimento, então só esses horários ficam disponíveis para agendar. \[e2e\]
- Dado um bloqueio (férias, feriado), então nenhuma consulta pode ser marcada nesse período. \[api\]

**US-AGE-05 · Link de teleconsulta (P2)** 🔶

Como nutricionista, quero anexar um link de videochamada à consulta, para atender a distância.

- Dado que marco a consulta como online, então o link é gerado ou informado e aparece no lembrete. \[e2e\]

**US-AGE-06 · Secretaria vê a agenda sem ver o prontuário (P2)** 🟡

Como titular, quero que a secretaria gerencie a agenda sem acessar dados clínicos, para proteger as informações dos pacientes.

- Dado um usuário com papel Secretaria, quando abre a agenda, então vê nome, horário e status da consulta. \[e2e\]
- Dado o mesmo usuário, quando tenta abrir anamnese, plano ou anexos, então o acesso é negado. \[seg\]

### 9.3 Anamnese e avaliação

**US-ANA-01 · Criar modelos de anamnese (P1)**

Como nutricionista, quero montar meus próprios formulários, para seguir o meu método de avaliação.

- Dado o construtor de formulário, quando adiciono campos de texto, número, escolha única, múltipla escolha e data, então o modelo é salvo e pode ser reutilizado. \[e2e\]
- Dado que edito um modelo já usado, então os preenchimentos anteriores permanecem inalterados (o modelo é versionado). \[api\]
- Dado um campo obrigatório, então o formulário não pode ser concluído sem ele. \[e2e\]

**US-ANA-02 · Preencher anamnese do paciente (P1)**

Como nutricionista, quero registrar a anamnese durante a consulta, para manter o histórico completo.

- Dado um modelo escolhido, quando preencho e salvo como rascunho, então posso retomar depois sem perder dados. \[e2e\]
- Dado que concluo, então o registro fica com data, autor e versão do modelo. \[api\]
- Dado que um segundo profissional da mesma conta edita, então a alteração fica registrada na auditoria. \[api\]

**US-ANA-03 · Registrar antropometria (P1)**

Como nutricionista, quero registrar peso, altura e medidas, para acompanhar a evolução.

- Dado peso e altura válidos, então o IMC é calculado automaticamente e arredondado em uma casa decimal. \[unit\]
- Dado valores fora de faixa plausível (por exemplo, peso abaixo de 1 kg ou acima de 500 kg), então o sistema recusa com mensagem clara. \[api\]
- Dado que troco a unidade (kg/lb, cm/m), então o valor é convertido corretamente e armazenado em unidade padrão. \[unit\]
- Dado que a idade do paciente é menor de 18 anos, então a classificação usa a referência pediátrica adequada ou indica que ela não se aplica. \[unit\]

**US-ANA-04 · Gráficos de evolução (P2)**

Como nutricionista, quero ver a evolução do paciente, para mostrar resultados e ajustar a conduta.

- Dado ao menos duas medições, então o gráfico de peso e IMC é exibido em ordem cronológica. \[e2e\]
- Dado menos de duas medições, então aparece mensagem orientando a registrar mais dados. \[e2e\]

**US-ANA-05 · Bioimpedância e dobras cutâneas (P2)**

Como nutricionista, quero registrar composição corporal, para ter uma avaliação mais completa.

- Dado os valores informados, então percentuais de gordura e massa magra são calculados pela fórmula escolhida e a fórmula fica registrada. \[unit\]

### 9.4 Plano alimentar

**US-PLA-01 · Montar plano alimentar (P1)**

Como nutricionista, quero montar o plano por refeição, para entregar uma orientação clara ao paciente.

- Dado um plano novo, quando adiciono refeições com horário e alimentos com quantidade (gramas ou medida caseira), então os totais por refeição e por dia são exibidos. \[e2e\]
- Dado que altero a quantidade de um alimento, então os totais são recalculados na hora. \[e2e\]
- Dado que removo um alimento ou refeição, então os totais refletem a remoção. \[e2e\]

**US-PLA-02 · Cálculo nutricional correto (P1)**

Como nutricionista, quero que os cálculos sejam confiáveis, para que eu possa assinar o plano com segurança.

- Dado um alimento da tabela de referência com 100 g, então calorias, macronutrientes e micronutrientes correspondem aos valores da tabela, dentro de tolerância definida (por exemplo, 0,1%). \[unit\]
- Dado uma medida caseira (por exemplo, colher de sopa), então a conversão em gramas segue o cadastro do alimento. \[unit\]
- Dado um nutriente sem informação na tabela, então o sistema mostra “não informado” e não soma zero silenciosamente. \[unit\]
- Dado um plano com vários alimentos, então a soma dos totais confere com a soma individual, sem erro de arredondamento acumulado perceptível. \[unit\]
- Dado um conjunto de planos de referência (golden files), então todos reproduzem os mesmos totais a cada execução do pipeline. \[unit\]

**US-PLA-03 · Escolher tabela de referência (P1)**

Como nutricionista, quero escolher a tabela (por exemplo, TACO ou TBCA), para seguir a referência que adoto.

- Dado que escolho a tabela padrão da conta, então novas buscas e cálculos usam essa tabela. \[e2e\]
- Dado um plano já salvo, quando a tabela é atualizada, então o plano mantém os valores da versão com que foi criado. \[api\]
- Dado um alimento exibido, então a fonte e a versão da tabela aparecem. \[e2e\]

**US-PLA-04 · Alimentos e receitas personalizados (P1)**

Como nutricionista, quero cadastrar alimentos próprios, para incluir produtos que não estão nas tabelas.

- Dado que cadastro um alimento com valores por 100 g, então ele fica disponível na busca apenas para o meu tenant. \[seg\]
- Dado uma receita composta por ingredientes, então os valores são calculados a partir deles, considerando o rendimento informado. \[unit\]

**US-PLA-05 · Substituições (P2)**

Como nutricionista, quero oferecer substituições equivalentes, para dar flexibilidade ao paciente.

- Dado um alimento do plano, quando adiciono um substituto, então o sistema mostra a diferença de calorias e macros. \[unit\]
- Dado que a diferença ultrapassa a tolerância configurada, então aparece um aviso. \[e2e\]

**US-PLA-06 · Gerar PDF com a marca do profissional (P1)**

Como nutricionista, quero exportar o plano em PDF, para entregar ao paciente.

- Dado um plano completo, quando gero o PDF, então ele contém dados do paciente, refeições, quantidades, totais e minha identidade visual (logo e dados do profissional). \[e2e\]
- Dado um plano extenso, então o PDF é paginado sem cortar linhas ou tabelas. \[e2e\]
- Dado a geração do PDF, então ela termina em até 10 segundos para planos de tamanho típico. \[api\]
- Dado uma alteração de layout no sistema, então o teste visual do PDF acusa diferenças inesperadas. \[e2e\]

**US-PLA-07 · Versionar planos (P1)**

Como nutricionista, quero manter o histórico dos planos, para comparar mudanças de conduta.

- Dado um plano já entregue, quando o edito, então uma nova versão é criada e a anterior fica preservada e consultável. \[api\]

### 9.5 Financeiro básico

**US-FIN-01 · Registrar cobrança de consulta (P1)**

Como nutricionista, quero registrar o que foi cobrado e pago, para controlar meus recebimentos.

- Dado uma consulta, quando registro valor e forma de pagamento, então a cobrança fica vinculada ao paciente e à consulta. \[e2e\]
- Dado um valor negativo ou vazio, então o sistema recusa. \[api\]
- Dado que marco como paga, então o status muda e a data de pagamento é gravada. \[api\]

**US-FIN-02 · Pacotes de consultas (P2)**

Como nutricionista, quero vender pacotes, para fidelizar pacientes.

- Dado um pacote com N consultas, quando uma consulta é realizada, então o saldo do pacote diminui em um. \[api\]
- Dado saldo zerado, então o sistema avisa ao agendar nova consulta. \[e2e\]

**US-FIN-03 · Resumo mensal (P2)**

Como nutricionista, quero ver quanto recebi e quanto está pendente, para me organizar.

- Dado um período, então vejo total recebido, total pendente e lista das cobranças. \[e2e\]
- Dado pagamentos de meses diferentes, então cada um entra no mês correto. \[unit\]

### 9.6 Requisitos transversais e painel do dono

**US-SEC-01 · Isolamento entre tenants (P1)** 🟡

Como dono da plataforma, quero garantir que nenhum nutricionista veja dados de outro, para proteger os pacientes e a empresa.

- Dado dois tenants (A e B) com dados cadastrados, quando um usuário de A tenta ler, alterar ou excluir qualquer recurso de B (por ID, busca, exportação ou anexo), então o sistema nega ou retorna vazio, em todos os endpoints. \[seg\]
- Dado a suíte de isolamento, então ela roda em todo pull request e bloqueia a integração se falhar. \[seg\]

**US-SEC-02 · Papéis e permissões (P1)** 🟡

Como titular, quero definir o que cada pessoa da equipe pode fazer, para limitar o acesso ao necessário.

- Dado os papéis Titular, Profissional e Secretaria, então cada um acessa apenas os módulos previstos na matriz de permissões. \[api\]
- Dado uma mudança de papel, então a nova permissão vale na próxima requisição, sem exigir novo login. \[api\]

**US-SEC-03 · Auditoria de acesso (P1)** 🔶

Como titular, quero saber quem acessou ou alterou dados de pacientes, para ter rastreabilidade.

- Dado qualquer leitura ou alteração de dados de paciente, então é gravado quem, quando e o quê, sem possibilidade de edição pelo usuário. \[api\]

**US-ADM-01 · Painel do dono: contagem de pacientes por tenant (P1)** 🟡

Como dono da plataforma, quero ver quantos pacientes cada nutricionista tem, para gerir planos e cobrança.

- Dado o painel, então vejo para cada tenant: plano, status, total de pacientes, pacientes ativos e percentual do limite. \[e2e\]
- Dado o papel super-admin, quando acesso qualquer endpoint clínico (pacientes, anamnese, planos, anexos, mensagens), então recebo acesso negado. \[seg\]
- Dado o painel, então nenhuma tela exibe nome, contato ou dado de saúde de paciente. \[e2e\]
- Dado uma ação administrativa (suspender, alterar plano), então ela é registrada na auditoria do super-admin. \[api\]

**US-ADM-02 · Limites do plano (P1)** 🟡

Como dono da plataforma, quero aplicar os limites de pacientes do plano, para sustentar o modelo de cobrança.

- Dado um tenant em 80% do limite, então ele recebe aviso dentro da plataforma e por e-mail. \[api\]
- Dado um tenant em 100% do limite, quando tenta cadastrar novo paciente, então o cadastro é bloqueado com convite ao upgrade, mas o acesso aos pacientes existentes continua. \[e2e\]
- Dado que o tenant faz upgrade, então o limite novo vale imediatamente. \[api\]

**US-ADM-03 · Contagem de pacientes ativos (P1)** 🟡

Como dono da plataforma, quero uma contagem diária e confiável, para cobrar de forma justa.

- Dado a regra de paciente ativo definida (por exemplo, atividade nos últimos 90 dias), então o job diário grava os contadores por tenant sem ler o conteúdo clínico. \[api\]
- Dado um paciente arquivado ou excluído, então ele deixa de entrar na contagem na próxima execução. \[api\]
- Dado uma falha do job, então há alerta e o painel indica a data da última atualização. \[api\]

### 9.7 Definição de pronto e automação

**Definição de pronto (para cada história)**

- Critérios de aceite escritos e revisados antes do desenvolvimento.
- Testes automatizados correspondentes aos critérios, com o ID da história no nome.
- Testes de isolamento e permissões passando no pipeline.
- Nenhum dado real de paciente usado em ambientes de teste.
- Registro em auditoria verificado quando a história altera dados de paciente.
- Revisão de acessibilidade básica nas telas novas.

**Mapa de automação sugerido**

- **Unitários:** cálculo de IMC e composição corporal, conversões de unidade e medida caseira, totais do plano, regras de paciente ativo e de limites.
- **API e integração:** isolamento de tenant, permissões por papel, auditoria, contadores do painel, lembretes.
- **E2E (poucos e estáveis):** cadastrar paciente, agendar consulta, preencher anamnese, montar plano e gerar PDF, atingir o limite do plano, super-admin sem acesso clínico.

**Dicas**

- Mantenha dois tenants de teste fixos (A e B) com dados sintéticos e use-os em toda a suíte.
- Monte um conjunto de alimentos e planos de referência com resultados conhecidos para os testes de cálculo.
- Espelhe estas histórias na ferramenta de gestão que você usa (por exemplo, o Jira), mantendo o ID como chave de rastreabilidade entre história, teste e entrega.

## 10. Fase 0 — Histórias de usuário e critérios de aceite

> **Situação das histórias:** 🟡 implementada (código e testes automatizados escritos; ainda não executados em ambiente real) · 🔶 parcial (ver seção 15.7) · sem marca = não iniciada. Nenhuma história é considerada aceita antes de os testes rodarem no pipeline.

Mesmas convenções da seção 9 (P1/P2 e tags \[unit\], \[api\], \[e2e\], \[seg\]). Aqui entram também histórias de engenharia, porque a Fase 0 constrói a base que as demais fases usam.

### 10.1 Autenticação e contas

**US-AUT-01 · Criar conta e iniciar trial (P1)** 🟡

Como nutricionista, quero criar minha conta e testar o sistema, para avaliar se ele atende ao meu trabalho.

- Dado um e-mail novo e senha que atende à política (tamanho mínimo e complexidade), quando me cadastro, então recebo um e-mail de confirmação e minha conta (tenant) é criada com o plano de trial de 14 dias, sem pedir cartão. \[e2e\]
- Dado um e-mail já cadastrado, quando tento me cadastrar, então vejo mensagem neutra que não confirma a existência da conta e oferece recuperar a senha. \[seg\]
- Dado que não confirmei o e-mail, quando tento acessar recursos do sistema, então sou direcionado para reenviar a confirmação. \[api\]
- Dado o cadastro concluído, então existem registros de conta, unidade padrão e usuário titular, todos vinculados ao mesmo tenant. \[api\]
- Dado o aceite dos termos, então versão e data do aceite ficam gravadas. \[api\]

**US-AUT-02 · Login e sessão (P1)** 🟡

Como usuário, quero entrar e sair com segurança, para proteger meus dados.

- Dado credenciais corretas, quando faço login, então acesso apenas os dados do meu tenant. \[e2e\]
- Dado credenciais incorretas, então a mensagem de erro é genérica, sem indicar se o e-mail existe. \[seg\]
- Dado 5 tentativas falhas seguidas (valor configurável), então a conta fica temporariamente bloqueada e o titular é avisado. \[seg\]
- Dado logout, então a sessão e os tokens deixam de funcionar imediatamente. \[api\]
- Dado inatividade acima do limite configurado, então a sessão expira e peço login novamente. \[api\]

**US-AUT-03 · Recuperar senha (P1)** 🟡

Como usuário, quero redefinir minha senha, para voltar a acessar a conta.

- Dado um e-mail informado, quando peço a recuperação, então a resposta é a mesma exista ou não a conta. \[seg\]
- Dado o link recebido, então ele é de uso único e expira em tempo curto (por exemplo, 1 hora). \[seg\]
- Dado que a senha foi alterada, então todas as sessões anteriores são encerradas e o titular recebe um aviso por e-mail. \[api\]

**US-AUT-04 · Autenticação em dois fatores (P1)** 🟡

Como usuário, quero ativar 2FA, para reforçar a segurança dos dados de saúde.

- Dado que ativo o 2FA por aplicativo autenticador, então recebo códigos de recuperação para guardar. \[e2e\]
- Dado o 2FA ativo, quando faço login, então o código é exigido após a senha. \[e2e\]
- Dado um código inválido ou reutilizado, então o acesso é negado. \[seg\]
- Dado que o super-admin usa o painel, então o 2FA é obrigatório, sem opção de desativar. \[seg\]

**US-AUT-05 · Convidar membros da equipe (P1)** 🟡

Como titular, quero convidar profissionais e secretaria, para trabalharem na mesma conta.

- Dado um e-mail e um papel (Profissional ou Secretaria), quando envio o convite, então o convidado recebe um link com validade de 7 dias. \[e2e\]
- Dado que o convidado aceita, então ele entra no meu tenant com o papel definido e nunca em outro. \[seg\]
- Dado que o plano tem limite de usuários, quando o limite é atingido, então novos convites são bloqueados com aviso de upgrade. \[api\]
- Dado que removo um membro, então seus acessos são revogados na hora e o histórico de ações dele é mantido. \[api\]

### 10.2 Planos, assinatura e limites

**US-PLN-01 · Configurar planos e limites (P1)** 🟡

Como dono da plataforma, quero cadastrar planos como configuração, para ajustar preços e faixas sem alterar código.

- Dado o painel, quando crio um plano com nome, preço, módulos, limite de pacientes, de usuários e de armazenamento, então ele fica disponível para contratação. \[e2e\]
- Dado que altero o preço de um plano, então assinaturas vigentes mantêm o valor atual até a renovação, conforme a regra definida, e os clientes são avisados. \[api\]
- Dado um plano desativado, então ele deixa de ser oferecido, mas quem já o tem continua usando. \[api\]
- Dado a regra de “paciente ativo” (por exemplo, 90 dias), então ela é um parâmetro configurável e não um valor fixo no código. \[unit\]

**US-PLN-02 · Contratar e pagar a assinatura (P1)** 🔶

Como nutricionista, quero contratar um plano, para continuar usando após o trial.

- Dado que escolho um plano e pago por cartão, Pix ou boleto, então a assinatura é ativada quando o gateway confirma o pagamento. \[e2e\]
- Dado que o gateway envia a mesma notificação mais de uma vez (webhook), então a assinatura é atualizada uma única vez (idempotência). \[api\]
- Dado uma notificação com assinatura inválida, então ela é rejeitada e registrada. \[seg\]
- Dado o pagamento aprovado, então a fatura fica disponível para download e a nota fiscal segue o fluxo definido. \[api\]

**US-PLN-03 · Trocar de plano (P1)** 🟡

Como nutricionista, quero fazer upgrade ou downgrade, para ajustar o plano ao meu volume.

- Dado um upgrade, então os novos limites valem imediatamente e o valor é ajustado conforme a regra de cobrança. \[api\]
- Dado um downgrade para um plano com limite menor que o número atual de pacientes, então o sistema informa o excesso e permite a troca sem apagar nenhum paciente, bloqueando apenas novos cadastros até regularizar. \[api\]
- Dado qualquer troca de plano, então o evento fica na linha do tempo do tenant no painel do dono. \[api\]

**US-PLN-04 · Fim do trial e inadimplência (P1)** 🟡

Como dono da plataforma, quero regras claras para trial vencido e atraso, para proteger a receita sem prejudicar pacientes.

- Dado que o trial termina sem assinatura, então o tenant entra em modo somente leitura e vê convite para contratar; nenhum dado é apagado. \[e2e\]
- Dado um pagamento em atraso, então o titular recebe avisos em prazos definidos e há um período de carência. \[api\]
- Dado o fim da carência, então novos cadastros são bloqueados, mas o acesso aos dados existentes e a exportação continuam disponíveis. \[api\]
- Dado que o pagamento é regularizado, então o acesso normal volta automaticamente. \[api\]

**US-PLN-05 · Cupons e plano anual (P2)**

Como dono da plataforma, quero oferecer descontos, para campanhas e retenção.

- Dado um cupom válido, quando aplicado na contratação, então o desconto aparece no resumo e na fatura. \[e2e\]
- Dado um cupom expirado ou esgotado, então ele é recusado com mensagem clara. \[api\]

### 10.3 Base de alimentos

**US-ALI-01 · Importar tabelas de composição (P1)** 🟡

Como dono da plataforma, quero importar TACO e TBCA de forma controlada, para oferecer dados confiáveis.

- Dado o arquivo de origem, quando rodo a importação, então a quantidade de alimentos importados confere com a da fonte e a versão e a origem ficam registradas. \[api\]
- Dado uma nova execução com o mesmo arquivo, então não há duplicatas (importação idempotente). \[api\]
- Dado uma amostra de alimentos de referência, então seus valores no sistema coincidem com os da fonte, dentro da tolerância definida. \[unit\]
- Dado uma linha com dado inválido, então ela é rejeitada e listada em um relatório de importação. \[api\]
- Dado que confirmei as condições de uso de cada tabela, então a atribuição de fonte aparece onde os dados são exibidos. \[e2e\]

**US-ALI-02 · Buscar alimentos (P1)** 🟡

Como nutricionista, quero achar alimentos rapidamente, para montar planos e fichas sem atrito.

- Dado um termo parcial, então a busca ignora acentos e maiúsculas e responde em até 300 ms para o catálogo completo. \[api\]
- Dado sinônimos comuns (por exemplo, “mandioca” e “aipim”), então os resultados incluem ambos. \[e2e\]
- Dado que escolhi uma tabela padrão, então os resultados dessa tabela aparecem primeiro. \[e2e\]

**US-ALI-03 · Alimentos próprios (P1)** 🟡

Como nutricionista, quero cadastrar alimentos e produtos industrializados, para cobrir o que não está nas tabelas.

- Dado valores por 100 g (ou por porção, convertidos), quando salvo, então o alimento fica disponível apenas para o meu tenant. \[seg\]
- Dado dados inconsistentes (por exemplo, soma de macros muito acima do possível), então o sistema alerta antes de salvar. \[unit\]

**US-ALI-04 · Medidas caseiras (P1)** 🟡

Como nutricionista, quero usar medidas caseiras, para falar a língua do paciente.

- Dado um alimento com medidas cadastradas, então posso escolher a medida e o sistema converte para gramas. \[unit\]
- Dado um alimento sem medida cadastrada, então apenas gramas são oferecidos, sem erro. \[e2e\]

### 10.4 LGPD e segurança de dados

**US-LGP-01 · Termos, privacidade e DPA (P1)** 🔶

Como dono da plataforma, quero registrar o aceite dos termos, para ter respaldo contratual e legal.

- Dado o cadastro, então o aceite dos termos de uso, da política de privacidade e do contrato de tratamento de dados é obrigatório. \[e2e\]
- Dado que uma nova versão dos termos é publicada, então os titulares precisam aceitar no próximo acesso, e o histórico de aceites é mantido. \[api\]

**US-LGP-02 · Exportar dados de um paciente (P1)** 🟡

Como nutricionista, quero exportar todos os dados de um paciente, para atender ao direito do titular.

- Dado um paciente, quando solicito a exportação, então recebo um arquivo com ficha, anamneses, planos, consultas e anexos, em formato legível. \[api\]
- Dado a exportação, então o arquivo só é acessível por link com expiração e para usuários autorizados do tenant. \[seg\]
- Dado a exportação, então o evento é registrado na auditoria. \[api\]

**US-LGP-03 · Excluir ou anonimizar dados (P1)** 🔶

Como nutricionista, quero excluir os dados de um paciente quando cabível, para cumprir pedidos legítimos.

- Dado um pedido de exclusão, então o sistema pede confirmação e informa eventuais prazos de guarda obrigatória configurados. \[e2e\]
- Dado a exclusão efetivada, então dados e anexos são removidos ou anonimizados, inclusive em índices de busca e filas. \[api\]
- Dado a rotina de backup, então a política define até quando o dado excluído permanece nas cópias e isso está documentado. \[api\]

**US-LGP-04 · Proteção técnica dos dados (P1)** 🔶

Como dono da plataforma, quero proteger os dados em repouso e em trânsito, para reduzir o risco de vazamento.

- Dado qualquer conexão, então apenas TLS é aceito. \[seg\]
- Dado um campo clínico sensível, então ele está cifrado no armazenamento e não aparece em texto aberto em logs ou mensagens de erro. \[seg\]
- Dado um backup, então ele é restaurado com sucesso em ambiente isolado em teste periódico, e o resultado é registrado. \[api\]

**US-LGP-05 · Auditoria base (P1)** 🔶

Como titular, quero o histórico de acessos e alterações, para ter rastreabilidade.

- Dado login, falha de login, alteração de permissão e exportação de dados, então cada evento é gravado com usuário, data e origem, em registro que o usuário não consegue editar. \[api\]

### 10.5 Painel do dono — versão 0

**US-ADM-00 · Lista e detalhe de tenants (P1)** 🟡

Como dono da plataforma, quero ver meus clientes e o uso de cada um, para acompanhar o negócio.

- Dado o painel, então vejo, por tenant: nome, e-mail, plano, status, data de cadastro, último acesso, número de pacientes (total e ativos) e número de usuários. \[e2e\]
- Dado filtros por plano, status e faixa de pacientes, então a lista responde corretamente e pode ser exportada em CSV. \[e2e\]
- Dado o papel super-admin, quando tenta acessar qualquer endpoint clínico, então o acesso é negado em todos eles. \[seg\]
- Dado o painel, então nenhuma tela mostra nome, contato ou dado de saúde de paciente. \[e2e\]
- Dado uma ação administrativa (suspender, alterar plano), então ela é registrada na auditoria do super-admin. \[api\]

### 10.6 Esteira de qualidade

**US-ENG-01 · Integração contínua (P1)** 🔶

Como equipe de desenvolvimento, quero que cada mudança seja validada automaticamente, para evitar regressões.

- Dado um pull request, então rodam testes unitários, de API, de isolamento de tenant e de permissões, e a integração é bloqueada se algum falhar. \[api\]
- Dado a suíte E2E, então os fluxos críticos rodam ao menos antes de cada release. \[e2e\]
- Dado o pipeline, então ele reporta tempo e cobertura, com meta mínima definida para a camada de cálculos. \[unit\]

**US-ENG-02 · Ambientes e dados de teste (P1)** 🔶

Como equipe de desenvolvimento, quero ambientes separados e dados sintéticos, para testar sem risco.

- Dado dev, staging e produção, então cada um tem banco, chaves e credenciais próprios. \[seg\]
- Dado o staging, então ele contém apenas dados sintéticos, com dois tenants fixos (A e B) para testes de isolamento. \[api\]
- Dado uma tentativa de copiar dados reais de produção para outro ambiente, então a política e os controles técnicos impedem. \[seg\]

**US-ENG-03 · Monitoramento e resposta a incidentes (P1)**

Como equipe de desenvolvimento, quero visibilidade de erros e disponibilidade, para agir rápido.

- Dado um erro em produção, então ele é capturado com contexto, sem dados pessoais de pacientes. \[seg\]
- Dado uma queda ou lentidão fora do limite, então a equipe recebe alerta. \[api\]
- Dado a documentação, então existe um plano de resposta a incidentes de segurança, com responsáveis e prazos de comunicação. \[e2e\]

### 10.7 Critérios de saída da Fase 0

A fase só termina quando:

- Todas as histórias P1 desta seção estão aceitas e automatizadas.
- A suíte de isolamento entre tenants e a de permissões do super-admin passam no pipeline.
- A importação da TACO e da TBCA está validada contra amostra de referência.
- Um fluxo completo de cadastro, trial, contratação e cobrança roda em staging com o gateway em modo de teste.
- O restore de backup foi testado e documentado.
- Termos de uso, política de privacidade e contrato de tratamento de dados foram revisados por um advogado.

## 11. Fase 3 — Histórias de usuário e critérios de aceite (Produção e qualidade)

**Convenções específicas**

- Perfis: **RT** (nutricionista responsável técnico), **Operador** (equipe de cozinha que preenche registros) e **Gestor** (contratante ou gerente da unidade).
- Tags: as mesmas das seções anteriores, mais \[mob\] para comportamento no celular e offline.
- Regras de normas sanitárias (RDC 216/2004 da Anvisa e normas estaduais e municipais) devem ser parâmetros configuráveis, não valores fixos no código. Valide os modelos iniciais com um profissional da área.
- Registros de qualidade são evidência: depois de fechados, não podem ser apagados; correções geram retificação com autor, data e motivo.

### 11.1 Fichas técnicas de preparação

**US-FIC-01 · Criar ficha técnica (P1)**

Como RT, quero cadastrar fichas técnicas, para padronizar preparações, custo e valor nutricional.

- Dado uma ficha com ingredientes, per capita, fator de correção (FC), fator de cocção (FCoc) e rendimento, quando salvo, então o sistema calcula peso bruto, peso líquido, custo por porção e valor nutricional por porção. \[unit\]
- Dado o FC de um ingrediente, então peso bruto = peso líquido × FC, e o resultado é igual ao de uma planilha de referência. \[unit\]
- Dado ingrediente sem preço cadastrado, então o custo é exibido como incompleto, sem assumir zero. \[unit\]
- Dado ingrediente sem dado nutricional, então o valor nutricional é marcado como parcial. \[unit\]
- Dado uma ficha criada, então ela fica visível apenas para o meu tenant (e às unidades que eu escolher). \[seg\]

**US-FIC-02 · Ajustar para número de porções (P1)**

Como RT, quero escalar a receita, para produzir diferentes volumes com as quantidades certas.

- Dado uma ficha para 10 porções, quando peço 250, então todas as quantidades são recalculadas proporcionalmente. \[unit\]
- Dado arredondamentos, então a soma das quantidades escaladas não diverge do total teórico além da tolerância definida. \[unit\]

**US-FIC-03 · Versionar ficha (P1)**

Como RT, quero manter o histórico das fichas, para saber qual versão foi usada em cada produção.

- Dado uma ficha já usada em produção, quando a edito, então uma nova versão é criada e a anterior permanece vinculada às produções passadas. \[api\]

**US-FIC-04 · Sub-receitas e custos atualizados (P2)**

Como RT, quero compor fichas a partir de outras (molhos, bases), para evitar retrabalho.

- Dado uma sub-receita usada em várias fichas, quando o custo de um ingrediente muda, então o custo das fichas dependentes é recalculado. \[unit\]
- Dado uma dependência circular entre fichas, então o sistema recusa e indica o ciclo. \[api\]

### 11.2 Cardápios institucionais

**US-CAR-01 · Montar cardápio por ciclo (P1)**

Como RT, quero planejar cardápios por período, para organizar a produção.

- Dado um ciclo (por exemplo, 14 dias), quando adiciono refeições e preparações por dia, então o cardápio exibe o calendário completo. \[e2e\]
- Dado a repetição de uma preparação em dias consecutivos, então aparece alerta configurável de repetição. \[e2e\]
- Dado que copio um ciclo para outro período, então as preparações são duplicadas sem alterar o original. \[api\]

**US-CAR-02 · Análise nutricional do cardápio (P1)**

Como RT, quero comparar o cardápio com as metas do público atendido, para garantir adequação.

- Dado metas por refeição (calorias, macronutrientes e outros nutrientes definidos), quando analiso o cardápio, então o sistema mostra o valor médio e o percentual de adequação por refeição e por dia. \[unit\]
- Dado um desvio acima da tolerância, então o dia aparece destacado com o nutriente fora da meta. \[e2e\]
- Dado que o público muda (escolar, hospitalar, industrial), então posso escolher outro conjunto de metas sem refazer o cardápio. \[e2e\]

**US-CAR-03 · Alérgenos e restrições (P1)**

Como RT, quero identificar alérgenos nas preparações, para proteger quem tem restrições.

- Dado ingredientes marcados com alérgenos, então cada preparação exibe os alérgenos presentes de forma automática. \[unit\]
- Dado uma preparação sem informação de alérgenos completa, então ela é sinalizada como “a verificar”, nunca como “sem alérgenos”. \[unit\]
- Dado que publico um cardápio, então os alérgenos aparecem no documento impresso e digital. \[e2e\]

**US-CAR-04 · Publicar cardápio (P1)**

Como RT, quero emitir o cardápio, para divulgar a quem consome.

- Dado um cardápio aprovado, quando exporto, então gero PDF com período, preparações, alérgenos e identidade da unidade. \[e2e\]
- Dado que o cardápio é alterado após a publicação, então a mudança fica registrada com data e autor. \[api\]

**US-CAR-05 · Dietas especiais e variações (P2)**

Como RT, quero cadastrar variações de dieta, para atender grupos específicos.

- Dado uma variação (sem glúten, sem lactose, textura modificada), então posso substituir preparações por dia e ver o impacto nutricional. \[e2e\]

### 11.3 Planejamento de produção

**US-PRO-01 · Necessidade de produção por dia (P1)**

Como RT ou Gestor, quero saber o que produzir e em que quantidade, para evitar falta e desperdício.

- Dado um cardápio e o número de comensais previsto, então o sistema calcula as quantidades de cada ingrediente usando as fichas técnicas. \[unit\]
- Dado que altero o número de comensais, então as quantidades são recalculadas na hora. \[e2e\]

**US-PRO-02 · Lista de compras (P1)**

Como Gestor, quero uma lista de compras consolidada, para comprar na quantidade certa.

- Dado um período de planejamento, então a lista agrupa ingredientes por fornecedor e desconta o estoque disponível. \[unit\]
- Dado a lista, quando exporto, então gero PDF ou planilha com unidades e quantidades corretas. \[e2e\]

**US-PRO-03 · Registro de produzido, servido e sobras (P1)**

Como Operador, quero registrar o que foi produzido e o que sobrou, para medir desperdício.

- Dado uma preparação do dia, quando informo quantidade produzida, servida e sobras, então o sistema calcula o percentual de sobra. \[unit\]
- Dado que a sobra passa do limite configurado, então o RT recebe alerta. \[api\]
- Dado o registro fechado, então ele não pode ser apagado, apenas retificado. \[api\]

### 11.4 Estoque e fornecedores

**US-EST-01 · Registrar recebimento (P1)**

Como Operador, quero lançar entradas de mercadorias, para manter o estoque e a rastreabilidade.

- Dado uma entrada, então registro item, quantidade, fornecedor, lote, validade e, quando aplicável, temperatura de recebimento. \[e2e\] \[mob\]
- Dado uma validade já vencida, então o sistema recusa a entrada ou exige justificativa de não conformidade. \[api\]
- Dado uma temperatura fora da faixa aceita para a categoria, então o item fica marcado como não conforme e o fluxo de NC é aberto. \[api\]
- Dado a leitura de código de barras pelo celular, então o item é preenchido automaticamente quando houver cadastro. \[mob\]

**US-EST-02 · Baixa de estoque por FEFO (P1)**

Como Operador, quero que o sistema use primeiro o que vence antes, para reduzir perdas.

- Dado vários lotes do mesmo item, quando dou baixa, então o sistema sugere o lote de validade mais próxima (FEFO). \[unit\]
- Dado uma baixa maior que o saldo, então ela é recusada com mensagem clara. \[api\]
- Dado a baixa, então o saldo por lote e o total ficam consistentes após qualquer sequência de entradas e saídas. \[unit\]

**US-EST-03 · Alertas de validade e estoque mínimo (P1)**

Como Gestor, quero ser avisado antes de perder mercadoria, para agir a tempo.

- Dado itens com validade em N dias (configurável), então eles aparecem em alerta e em relatório. \[api\]
- Dado saldo abaixo do mínimo, então o item entra na sugestão de compra. \[api\]

**US-EST-04 · Inventário (P2)**

Como Gestor, quero fazer contagens periódicas, para conciliar o estoque.

- Dado uma contagem, então diferenças em relação ao saldo geram ajuste com motivo, autor e data. \[api\]

**US-FOR-01 · Fornecedores e avaliação (P2)**

Como RT, quero cadastrar e avaliar fornecedores, para homologar quem atende aos requisitos.

- Dado um fornecedor, então registro documentos e validade (por exemplo, licença sanitária) com alerta de vencimento. \[api\]
- Dado recebimentos com não conformidade, então a nota do fornecedor é atualizada conforme a regra definida. \[unit\]

### 11.5 Checklists de boas práticas

**US-CHK-01 · Criar modelo de checklist (P1)**

Como RT, quero montar checklists, para auditar as boas práticas da unidade.

- Dado o construtor, quando crio itens com resposta conforme, não conforme ou não se aplica, e itens com peso, então o modelo é salvo. \[e2e\]
- Dado um modelo padrão baseado nas normas aplicáveis, então posso copiá-lo e adaptá-lo. \[e2e\]
- Dado a edição de um modelo em uso, então execuções antigas continuam com a versão com que foram feitas. \[api\]

**US-CHK-02 · Executar checklist (P1)**

Como Operador, quero preencher o checklist pelo celular, para registrar a rotina sem burocracia.

- Dado um checklist atribuído a mim, quando respondo os itens, então posso anexar foto e observação em cada um. \[e2e\] \[mob\]
- Dado que estou sem internet, então consigo preencher e os dados sincronizam quando a conexão volta, sem duplicar nem perder respostas. \[mob\]
- Dado a conclusão, então o checklist exige assinatura ou confirmação do responsável e fica fechado. \[api\]

**US-CHK-03 · Pontuação de conformidade (P1)**

Como RT, quero uma nota de conformidade, para acompanhar a evolução.

- Dado as respostas e os pesos, então a pontuação percentual é calculada e itens “não se aplica” não entram no cálculo. \[unit\]
- Dado itens críticos não conformes, então o resultado é classificado como reprovado independentemente da nota. \[unit\]

**US-CHK-04 · Agendamento e atrasos (P1)**

Como RT, quero programar checklists recorrentes, para garantir a rotina.

- Dado uma recorrência (diária, semanal, mensal), então as tarefas são geradas no horário certo, no fuso da unidade. \[api\]
- Dado uma tarefa não realizada no prazo, então ela aparece como atrasada e o RT é notificado. \[api\]

### 11.6 Controles diários

**US-CTL-01 · Registro de temperaturas (P1)**

Como Operador, quero registrar temperaturas nos horários definidos, para comprovar o controle.

- Dado equipamentos cadastrados (câmaras, estufas, balcões) com faixa aceitável, quando registro o valor, então ele é salvo com data, hora e autor. \[e2e\] \[mob\]
- Dado um valor fora da faixa, então o sistema exige ação corretiva e abre automaticamente uma não conformidade. \[api\]
- Dado um horário de registro perdido, então aparece pendência e alerta ao RT. \[api\]
- Dado o histórico, então gero gráfico por equipamento e período. \[e2e\]

**US-CTL-02 · Higienização e controle de óleo (P2)**

Como Operador, quero registrar limpeza e troca de óleo, para manter a rotina documentada.

- Dado um registro de limpeza, então ele indica área, produto, responsável e horário. \[e2e\]
- Dado a medição de compostos polares ou a data de troca de óleo, então o sistema alerta quando o limite configurado for atingido. \[unit\]

**US-CTL-03 · Controle de amostras (P2)**

Como Operador, quero registrar as amostras coletadas, para atender à guarda exigida.

- Dado uma coleta, então o sistema registra preparação, data, hora e prazo de guarda configurável conforme a norma aplicável. \[api\]
- Dado o fim do prazo, então o sistema indica que a amostra pode ser descartada e registra o descarte. \[api\]

### 11.7 Não conformidades e planos de ação

**US-NCF-01 · Abrir não conformidade (P1)**

Como RT, quero registrar desvios, para tratá-los de forma rastreável.

- Dado um item reprovado em checklist, temperatura fora da faixa ou recebimento não conforme, então uma NC é criada automaticamente com origem, data e evidências. \[api\]
- Dado uma NC aberta manualmente, então posso descrever, classificar a gravidade e anexar fotos. \[e2e\]

**US-NCF-02 · Plano de ação (P1)**

Como RT, quero definir correções, para resolver a causa e evitar reincidência.

- Dado uma NC, quando crio ações com responsável e prazo, então cada responsável é notificado. \[api\]
- Dado um prazo vencido, então a ação aparece atrasada e o RT é avisado. \[api\]

**US-NCF-03 · Verificar eficácia e encerrar (P1)**

Como RT, quero encerrar a NC só depois de verificar a solução, para evitar fechamento sem resultado.

- Dado que todas as ações foram concluídas, quando registro a verificação de eficácia com data e responsável, então a NC pode ser encerrada. \[api\]
- Dado uma NC encerrada, então ela não pode ser alterada, apenas reaberta com justificativa. \[api\]

**US-NCF-04 · Painel de NCs (P1)**

Como Gestor, quero ver o panorama de desvios, para priorizar o que importa.

- Dado o painel, então vejo NCs abertas, atrasadas e encerradas por período, gravidade e origem. \[e2e\]

### 11.8 Documentos da qualidade

**US-DOC-01 · Versionar documentos (P1)**

Como RT, quero controlar POPs, manual e APPCC, para garantir que todos usem a versão vigente.

- Dado um documento, quando publico uma nova versão, então a anterior fica arquivada e consultável, e apenas a vigente aparece como padrão. \[api\]
- Dado a publicação, então ficam registrados autor, data e descrição da mudança. \[api\]

**US-DOC-02 · Validade e revisão (P1)**

Como RT, quero ser lembrado de revisar documentos, para manter a conformidade.

- Dado uma data de validade ou periodicidade de revisão, então o sistema alerta com antecedência configurável. \[api\]
- Dado um documento vencido, então ele aparece sinalizado como desatualizado. \[e2e\]

**US-DOC-03 · Modelos editáveis (P2)**

Como RT, quero partir de modelos prontos, para ganhar tempo.

- Dado um modelo de POP ou manual, quando o copio, então ele vira um documento meu, editável e independente do modelo. \[e2e\]

**US-DOC-04 · Ciência de leitura e treinamento (P2)**

Como RT, quero comprovar que a equipe leu os documentos, para registrar treinamentos.

- Dado um documento atribuído a uma equipe, quando cada pessoa confirma a leitura, então fica registrado quem, quando e qual versão. \[api\]

### 11.9 Rastreabilidade

**US-RAS-01 · Vincular lotes às preparações (P1)**

Como Operador, quero informar os lotes usados em cada preparação, para manter a cadeia rastreável.

- Dado uma preparação, quando registro os lotes dos ingredientes, então o vínculo é salvo e o estoque baixa dos lotes indicados. \[api\]
- Dado que não informo lote para um ingrediente que exige rastreio, então o sistema alerta antes de fechar a produção. \[e2e\]

**US-RAS-02 · Consulta de rastreabilidade (P1)**

Como RT, quero localizar rapidamente onde um lote foi usado, para agir em caso de ocorrência.

- Dado um lote, quando consulto, então vejo preparações, datas e refeições servidas que o utilizaram. \[api\]
- Dado uma refeição servida, quando consulto na direção inversa, então vejo os lotes e fornecedores de todos os ingredientes. \[api\]
- Dado uma base com volume realista de dados, então a consulta responde em poucos segundos. \[api\]

**US-RAS-03 · Relatório de recolhimento (P2)**

Como RT, quero gerar um relatório de recall, para responder a fornecedores e à vigilância sanitária.

- Dado um lote sob suspeita, então o relatório lista produções, quantidades e destinos, e pode ser exportado em PDF. \[e2e\]

### 11.10 Requisitos transversais da Fase 3

**US-SEC-04 · Acesso por unidade e por perfil (P1)**

Como titular, quero limitar o que cada pessoa vê, para que a equipe de uma cozinha não mexa na outra.

- Dado usuários vinculados à Unidade A, quando tentam acessar dados da Unidade B do mesmo tenant, então o acesso é negado. \[seg\]
- Dado o perfil Operador, então ele vê apenas as tarefas e registros que lhe cabem e não consegue editar registros fechados. \[seg\]
- Dado o perfil RT, então ele pode aprovar, retificar e encerrar registros dentro das unidades sob sua responsabilidade. \[api\]
- Dado o isolamento entre tenants, então a suíte da seção 9 (US-SEC-01) é estendida para cobrir todos os recursos deste módulo. \[seg\]

**US-SEC-05 · Imutabilidade e retificação (P1)**

Como RT, quero que registros fechados não sejam alterados sem rastro, para que sirvam de evidência.

- Dado um registro fechado (checklist, temperatura, recebimento, NC), quando preciso corrigir, então o sistema cria uma retificação ligada ao original, com motivo, autor e data. \[api\]
- Dado qualquer tentativa de edição ou exclusão direta, então ela é recusada. \[seg\]

**US-ADM-04 · Cobrança do módulo Produção no painel do dono (P1)**

Como dono da plataforma, quero gerir a cobrança por unidade e por usuário, para precificar o módulo de produção.

- Dado o painel, então vejo por tenant o número de unidades e usuários do módulo Produção, os módulos contratados e o percentual dos limites usados. \[e2e\]
- Dado o painel, então nenhum registro de cozinha (temperaturas, checklists, NCs, fichas, estoque) é exibido, apenas contagens. \[seg\]
- Dado um tenant que atinge o limite de unidades, então novas unidades são bloqueadas com convite ao upgrade, sem afetar as existentes. \[api\]

### 11.11 Definição de pronto e automação

**Definição de pronto**

- Critérios de aceite revisados com ao menos um RT real antes do desenvolvimento.
- Testes automatizados com o ID da história no nome.
- Fluxos principais testados também no celular e em modo offline.
- Alertas e prazos testados com relógio simulado, sem depender de esperar o tempo real.
- Isolamento por tenant e por unidade validado no pipeline.
- Modelos iniciais de checklist e documentos revisados por profissional da área.

**Mapa de automação sugerido**

- **Unitários:** FC, FCoc, rendimento, custo por porção, escala de receitas, FEFO, saldo de estoque, pontuação de checklist, regras de alérgenos, percentual de sobra.
- **API e integração:** alertas e prazos, abertura automática de NC, imutabilidade, rastreabilidade (consulta direta e inversa), permissões por unidade e perfil.
- **Mobile e offline:** preencher checklist sem conexão, sincronizar, resolver conflitos (dois usuários no mesmo registro) e evitar duplicidade.
- **E2E (poucos e estáveis):** receber mercadoria, dar baixa, produzir uma preparação, registrar sobras e consultar a rastreabilidade do lote; checklist reprovado gerando NC até o encerramento.

**Dicas**

- Monte uma cozinha fictícia com ciclo de cardápio de 7 dias, fichas técnicas com resultados conhecidos (golden files) e lotes com validades variadas.
- Use relógio injetável nos testes para validar vencimentos, atrasos e recorrências.
- Registre cada regra normativa usada como parâmetro configurável, com a referência da norma, para ajustar por estado ou município sem alterar código.

## 12. Fase 2 — Histórias de usuário e critérios de aceite (Clínico avançado e engajamento)

**Convenções específicas**

- Passa a existir um novo perfil: **Paciente**. Ele acessa apenas os próprios dados, por um portal ou app separado do sistema do profissional.
- Mesmas tags das seções anteriores: \[unit\], \[api\], \[e2e\], \[seg\] e \[mob\].
- Regra de ouro: o acesso do paciente depende de convite do nutricionista e de consentimento específico, e pode ser revogado a qualquer momento.

### 12.1 Portal e app do paciente

**US-POR-01 · Convidar paciente para o portal (P1)**

Como nutricionista, quero convidar o paciente para o portal, para ele acompanhar o plano e interagir comigo.

- Dado um paciente com e-mail, quando envio o convite, então ele recebe um link de uso único com validade definida. \[api\]
- Dado o link, quando o paciente cria a senha e aceita os termos e o consentimento do portal, então o acesso é ativado e o aceite fica registrado com data e versão. \[e2e\]
- Dado um paciente sem o consentimento do portal, então ele não consegue acessar nenhum dado. \[seg\]
- Dado que revogo o acesso, então as sessões do paciente são encerradas imediatamente e o histórico clínico permanece comigo. \[api\]
- Dado o convite, então o paciente fica vinculado apenas ao meu tenant e ao seu próprio cadastro. \[seg\]

**US-POR-02 · Ver plano alimentar e metas (P1)**

Como paciente, quero ver meu plano alimentar atual, para seguir a orientação no dia a dia.

- Dado um plano publicado pelo nutricionista, então vejo refeições, quantidades, substituições e o PDF para baixar. \[e2e\]
- Dado um plano em rascunho, então ele não aparece para mim. \[seg\]
- Dado que o nutricionista publica uma nova versão, então vejo a versão vigente e sou avisado. \[api\]
- Dado versões anteriores, então posso consultá-las identificadas como antigas. \[e2e\]

**US-POR-03 · Agenda e confirmação de consultas (P1)**

Como paciente, quero ver e confirmar minhas consultas, para não faltar.

- Dado uma consulta marcada, então vejo data, hora, local ou link de teleconsulta. \[e2e\]
- Dado que confirmo presença, então o nutricionista vê o status atualizado. \[api\]
- Dado um pedido de remarcação, então ele chega ao nutricionista como solicitação, sem alterar a agenda automaticamente. \[api\]

**US-POR-04 · Metas e progresso (P2)**

Como paciente, quero acompanhar metas combinadas, para me manter motivado.

- Dado metas definidas pelo nutricionista (por exemplo, água, passos, frequência), quando registro o progresso, então ele aparece em gráfico semanal. \[e2e\]
- Dado que o nutricionista altera uma meta, então o histórico anterior é preservado. \[api\]

**US-POR-05 · Gerenciar meus dados e consentimentos (P1)**

Como paciente, quero controlar meus dados, para exercer meus direitos.

- Dado o portal, então posso ver os consentimentos dados e revogá-los. \[e2e\]
- Dado que solicito cópia dos meus dados, então o pedido chega ao nutricionista (controlador) com prazo e status. \[api\]
- Dado que revogo o consentimento do portal, então o acesso é encerrado e o nutricionista é notificado. \[api\]

### 12.2 Diário alimentar

**US-DIA-01 · Registrar refeições (P1)**

Como paciente, quero registrar o que comi, para que meu nutricionista acompanhe a rotina.

- Dado uma refeição, quando informo horário, descrição e foto (opcional), então o registro é salvo e aparece no meu histórico. \[e2e\] \[mob\]
- Dado uma foto de tipo ou tamanho inválido, então ela é recusada com mensagem clara. \[api\]
- Dado que estou sem conexão no app, então o registro é guardado e enviado depois, sem duplicar. \[mob\]
- Dado que apago um registro meu, então ele sai da minha visão e a ação fica registrada. \[api\]

**US-DIA-02 · Nutricionista revisa o diário (P1)**

Como nutricionista, quero revisar os registros do paciente, para ajustar a conduta.

- Dado os registros de um período, então vejo por dia, com fotos, horários e comentários do paciente. \[e2e\]
- Dado que comento um registro, então o paciente é avisado e vê o comentário no portal. \[api\]
- Dado que marco o dia como revisado, então o status fica visível para ambos. \[e2e\]
- Dado o registro do paciente, então eu não consigo editar o texto original, apenas comentar. \[api\]

**US-DIA-03 · Comparar diário com o plano (P2)**

Como nutricionista, quero medir a aderência ao plano, para orientar com dados.

- Dado registros vinculados a alimentos do plano, então o sistema calcula o percentual de aderência por refeição e por dia. \[unit\]
- Dado registros em texto livre sem alimento identificado, então a aderência é marcada como “não calculável” e não entra como zero. \[unit\]
- Dado valores nutricionais estimados a partir do diário, então eles aparecem identificados como estimativa. \[e2e\]

**US-DIA-04 · Lembretes de registro (P2)**

Como paciente, quero ser lembrado de registrar, para criar o hábito.

- Dado horários configurados, então recebo lembretes sem conteúdo clínico na mensagem. \[api\]
- Dado que desativo os lembretes, então nenhum é enviado. \[api\]

### 12.3 Mensagens e acompanhamento

**US-MSG-01 · Chat entre nutricionista e paciente (P1)**

Como nutricionista ou paciente, quero trocar mensagens dentro da plataforma, para manter o histórico em um só lugar.

- Dado um vínculo ativo, então ambos podem enviar texto e anexos dentro dos limites definidos. \[e2e\]
- Dado um paciente sem vínculo ativo (arquivado ou acesso revogado), então ele não consegue enviar mensagens. \[seg\]
- Dado mensagens novas, então aparecem como não lidas até serem abertas. \[e2e\]
- Dado a notificação por e-mail ou push, então ela diz apenas que há uma nova mensagem, sem trecho do conteúdo. \[seg\]
- Dado o histórico, então ele fica vinculado à ficha do paciente e visível só aos profissionais autorizados do tenant. \[seg\]

**US-MSG-02 · Horário de atendimento e resposta automática (P2)**

Como nutricionista, quero definir quando respondo, para alinhar expectativas.

- Dado uma mensagem fora do horário, então o paciente recebe aviso com o horário de resposta e a orientação para urgências (texto definido pelo profissional). \[api\]

**US-MSG-03 · Check-ins e lembretes automáticos (P2)**

Como nutricionista, quero programar check-ins, para acompanhar sem esforço manual.

- Dado um check-in semanal configurado, então o paciente recebe as perguntas no dia e as respostas aparecem na ficha. \[e2e\]
- Dado limite de frequência definido, então o sistema nunca envia acima dele para o mesmo paciente. \[api\]
- Dado que o paciente pede para não receber, então os envios param. \[api\]

### 12.4 Protocolos e modelos reutilizáveis

**US-PRT-01 · Salvar e aplicar modelos de plano (P1)**

Como nutricionista, quero transformar um plano em modelo, para reaproveitá-lo em pacientes semelhantes.

- Dado um plano, quando o salvo como modelo, então ele fica na minha biblioteca sem dados identificáveis do paciente de origem. \[api\]
- Dado um modelo aplicado a um paciente, então o plano criado é uma cópia independente. \[api\]
- Dado que edito o modelo depois, então planos já aplicados não mudam. \[api\]
- Dado a aplicação do modelo, então o sistema recalcula totais e mostra desvio em relação às metas do paciente. \[unit\]

**US-PRT-02 · Biblioteca e busca de modelos (P2)**

Como nutricionista, quero organizar meus modelos, para achar o certo rápido.

- Dado tags por perfil (emagrecimento, gestação, esporte, outros), então posso filtrar e buscar. \[e2e\]
- Dado a duplicação de um modelo, então a cópia é independente. \[api\]
- Dado uma conta com várias pessoas, então posso escolher entre modelo pessoal e compartilhado com a equipe. \[seg\]

### 12.5 Prescrição de suplementos e exames

**US-SUP-01 · Prescrever suplementos (P1)**

Como nutricionista, quero registrar suplementação, para integrá-la ao plano.

- Dado um suplemento com dose, frequência, horário e duração, então ele aparece no plano, no PDF e no portal do paciente. \[e2e\]
- Dado o mesmo suplemento prescrito duas vezes, então o sistema avisa sobre duplicidade. \[api\]
- Dado o término da duração, então ele sai da lista vigente e permanece no histórico. \[api\]
- Dado a prescrição, então o documento indica o profissional responsável e seu registro. \[e2e\]

**US-EXA-01 · Solicitar exames (P2)**

Como nutricionista, quero emitir solicitações de exames, para acompanhar o paciente.

- Dado uma lista de exames de um modelo, quando gero a solicitação, então obtenho PDF com identificação do paciente e do profissional. \[e2e\]
- Dado que edito a lista, então o modelo original não muda. \[api\]

**US-EXA-02 · Registrar resultados e acompanhar evolução (P1)**

Como nutricionista, quero registrar resultados de exames, para comparar ao longo do tempo.

- Dado um exame com valor, unidade e data, então o resultado é salvo e vinculado ao paciente. \[api\]
- Dado a faixa de referência cadastrada pelo profissional, então valores fora da faixa aparecem destacados, sem o sistema emitir diagnóstico. \[unit\]
- Dado unidades diferentes para o mesmo exame, então o sistema converte para uma unidade padrão de comparação. \[unit\]
- Dado dois ou mais resultados, então o gráfico mostra a evolução em ordem cronológica. \[e2e\]
- Dado um arquivo de exame anexado, então valem as regras de segurança de anexos da seção 9. \[seg\]

### 12.6 Necessidades nutricionais

**US-NEC-01 · Calcular TMB e GET (P1)**

Como nutricionista, quero calcular as necessidades energéticas, para definir metas com base em evidência.

- Dado idade, sexo informado, peso e altura, quando escolho uma fórmula (por exemplo, Harris-Benedict, Mifflin-St Jeor ou FAO/OMS), então o sistema calcula a TMB e o GET com o fator de atividade escolhido. \[unit\]
- Dado um conjunto de casos de referência com resultados conhecidos, então todas as fórmulas reproduzem os valores esperados. \[unit\]
- Dado o resultado, então ele mostra qual fórmula e qual fator foram usados, e isso fica registrado no plano. \[e2e\]
- Dado dados faltantes ou fora de faixa (por exemplo, idade abaixo do limite de aplicação da fórmula), então o sistema bloqueia o cálculo e explica o motivo. \[api\]

**US-NEC-02 · Definir metas de calorias e macros (P1)**

Como nutricionista, quero definir metas, para guiar o plano.

- Dado metas por percentual do valor energético ou por g/kg de peso, então os valores em gramas são calculados. \[unit\]
- Dado percentuais que não somam 100%, então o sistema avisa e não salva. \[api\]
- Dado um plano com metas vinculadas, então o sistema mostra desvio por dia e destaca o que ultrapassa a tolerância. \[e2e\]

**US-NEC-03 · Ajustes por condição ou fase da vida (P2)**

Como nutricionista, quero ajustes para situações específicas, para individualizar a conduta.

- Dado uma condição selecionada (por exemplo, gestação, idoso ou esportista), então o sistema oferece os parâmetros e referências correspondentes, cada um com sua fonte. \[e2e\]
- Dado a sugestão, então o profissional pode aceitar, editar ou ignorar, e a decisão fica registrada. \[api\]

### 12.7 Requisitos transversais da Fase 2

**US-SEC-06 · Isolamento entre pacientes (P1)**

Como dono da plataforma, quero que nenhum paciente veja dados de outro, para cumprir a promessa de privacidade.

- Dado dois pacientes do mesmo nutricionista, quando o paciente A tenta acessar qualquer recurso do paciente B (por ID, busca ou anexo), então o acesso é negado. \[seg\]
- Dado o token de um paciente, quando usado em endpoints do profissional, então o acesso é negado em todos eles. \[seg\]
- Dado a suíte de isolamento das fases anteriores, então ela é estendida para o portal do paciente e roda em todo pull request. \[seg\]

**US-SEC-07 · Notificações seguras (P1)**

Como titular, quero que e-mails e push não vazem informação, para proteger o paciente.

- Dado qualquer notificação, então ela não contém dados clínicos nem trechos de mensagens, apenas um aviso genérico e um link autenticado. \[seg\]
- Dado um link de notificação, então ele exige login e expira quando aplicável. \[seg\]

**US-ADM-05 · Painel do dono: uso do portal (P2)**

Como dono da plataforma, quero ver como o portal é usado, para entender engajamento e custo.

- Dado o painel, então vejo por tenant: pacientes com portal ativo, mensagens enviadas no mês e armazenamento de fotos, apenas como contagens. \[e2e\]
- Dado o papel super-admin, quando tenta acessar mensagens, diários ou anexos, então o acesso é negado. \[seg\]
- Dado a regra de “paciente ativo”, então paciente com uso do portal no período conta como ativo. \[unit\]

### 12.8 Critérios de saída, definição de pronto e automação

**Critérios de saída da Fase 2**

- Histórias P1 desta seção aceitas e automatizadas.
- Suíte de isolamento cobrindo tenant, paciente e super-admin passando no pipeline.
- Convite, consentimento e revogação do portal testados de ponta a ponta.
- Notificações auditadas para garantir ausência de dados clínicos.
- Fórmulas de TMB e GET validadas contra casos de referência.

**Mapa de automação sugerido**

- **Unitários:** TMB, GET, metas de macros, aderência ao plano, conversão de unidades de exames, desvio de modelo.
- **API e integração:** isolamento de paciente, consentimento e revogação, vínculo ativo para mensagens, limites de frequência de envio.
- **Mobile:** registro offline do diário, sincronização sem duplicidade, notificações.
- **E2E (poucos e estáveis):** convidar paciente, aceitar o convite, ver o plano, registrar uma refeição, receber o comentário do nutricionista; revogar o consentimento e perder o acesso.

**Dicas**

- Mantenha no staging pacientes sintéticos A e B por tenant para testar isolamento.
- Use caixa de e-mail de teste (sandbox) para validar o conteúdo das notificações automaticamente.
- Inclua nos testes de privacidade uma verificação automática de que notificações não carregam trechos de mensagens nem dados de saúde.
- Revise com um advogado o texto de consentimento do portal e a política de retenção de mensagens e diários.

## 13. Fase 4 — Histórias de usuário e critérios de aceite (Diferenciais e escala)

**Convenções específicas**

- Esta fase reúne recursos independentes entre si. Priorize por demanda real dos clientes e implemente cada bloco como um mini-projeto, com piloto fechado antes de liberar a todos.
- Tags: \[unit\], \[api\], \[e2e\], \[seg\], \[mob\] e \[ia\] para critérios de qualidade do assistente com IA.
- Regra que continua valendo: o dono da plataforma nunca acessa conteúdo clínico de pacientes, mesmo com os novos recursos.

### 13.1 Dashboards gerenciais

**US-DSH-01 · Dashboard do consultório (P1)**

Como nutricionista, quero ver indicadores do meu consultório, para decidir com dados.

- Dado um período, então vejo pacientes novos e ativos, consultas realizadas, faltas e cancelamentos, receita recebida e pendente. \[e2e\]
- Dado cada indicador, então o valor confere com a soma dos registros de origem em teste de reconciliação automatizado. \[unit\]
- Dado o perfil Secretaria, então os indicadores clínicos individuais não aparecem para ela. \[seg\]
- Dado filtros por profissional e unidade, então os números refletem apenas o que o usuário pode ver. \[seg\]

**US-DSH-02 · Dashboard de produção e qualidade (P1)**

Como RT ou Gestor, quero indicadores de cozinha, para agir sobre o que está fora do esperado.

- Dado um período e uma unidade, então vejo conformidade média de checklists, temperaturas fora da faixa, não conformidades abertas e atrasadas, custo por refeição e percentual de sobras. \[e2e\]
- Dado várias unidades, então posso compará-las lado a lado. \[e2e\]
- Dado um indicador, então posso abrir os registros que o compõem (drill-down). \[e2e\]
- Dado o indicador de custo, então ele considera apenas fichas com custo completo e avisa quando há dados incompletos. \[unit\]

**US-DSH-03 · Relatórios agendados e exportação (P2)**

Como Gestor, quero receber relatórios periódicos, para acompanhar sem precisar entrar no sistema.

- Dado um relatório agendado, então ele chega por e-mail no dia e horário definidos, em PDF ou planilha, sem dados clínicos de pacientes individuais. \[api\]
- Dado a exportação, então ela respeita as permissões do usuário que a gerou. \[seg\]

**US-DSH-04 · Desempenho dos dashboards (P1)**

Como usuário, quero que os painéis abram rápido, para usá-los no dia a dia.

- Dado um tenant com volume realista de dados (por exemplo, 3 anos de histórico), então os painéis carregam em até 3 segundos. \[api\]
- Dado agregações pré-calculadas, então elas são atualizadas no intervalo definido e mostram a data da última atualização. \[api\]

### 13.2 Relatórios de auditoria

**US-AUD-01 · Pacote para a vigilância sanitária (P1)**

Como RT, quero gerar um dossiê pronto para fiscalização, para responder rápido a inspeções.

- Dado um período e uma unidade, então o pacote reúne checklists, controles de temperatura, não conformidades com status, documentos vigentes com versão e registros de treinamento. \[e2e\]
- Dado registros retificados, então o relatório mostra o original e a retificação com autor, data e motivo. \[api\]
- Dado o PDF, então ele tem índice, data de emissão e identificação da unidade e do responsável. \[e2e\]
- Dado lacunas no período (por exemplo, dias sem registro de temperatura), então o relatório as destaca em vez de omiti-las. \[unit\]

**US-AUD-02 · Relatório para auditoria de cliente (P2)**

Como Gestor, quero um relatório configurável, para atender auditorias de contratantes.

- Dado seleção de seções e período, então o relatório inclui apenas o que foi escolhido. \[e2e\]
- Dado o relatório gerado, então a geração fica registrada na auditoria. \[api\]

**US-AUD-03 · Trilha de acessos a dados de pacientes (P1)**

Como titular, quero exportar quem acessou os dados dos meus pacientes, para demonstrar controle em caso de questionamento.

- Dado um período, então exporto a lista de acessos e alterações com usuário, data, ação e recurso, sem exibir o conteúdo clínico. \[api\]
- Dado o registro de auditoria, então ele continua sem possibilidade de edição pelo usuário. \[seg\]

### 13.3 Integrações

**US-INT-01 · WhatsApp oficial (P1)**

Como nutricionista, quero enviar lembretes pelo WhatsApp, para aumentar a confirmação de consultas.

- Dado a conexão com o canal oficial, então posso enviar lembretes usando modelos de mensagem aprovados. \[e2e\]
- Dado um paciente sem consentimento de contato por WhatsApp, então nenhuma mensagem é enviada. \[api\]
- Dado uma falha de envio, então o sistema registra o motivo e usa o e-mail como alternativa, se configurado. \[api\]
- Dado os custos do canal, então o tenant vê o consumo no mês e um limite configurável. \[api\]
- Dado a mensagem enviada, então ela não contém dados clínicos além do necessário (data, hora e local da consulta). \[seg\]

**US-INT-02 · Google Agenda (P2)**

Como nutricionista, quero sincronizar minha agenda, para ver tudo em um só lugar.

- Dado a conexão autorizada, então consultas criadas no sistema aparecem como eventos, e eventos criados no calendário podem ser vinculados a pacientes. \[e2e\]
- Dado o evento criado no Google, então ele não contém dados clínicos, apenas um título genérico e, no máximo, as iniciais do paciente. \[seg\]
- Dado conflito entre alterações nos dois lados, então a regra definida resolve e a mudança fica registrada. \[api\]
- Dado que revogo a autorização, então a sincronização para e os tokens são apagados. \[seg\]

**US-INT-03 · Termômetros e dataloggers (P2)**

Como RT, quero que as temperaturas entrem automaticamente, para reduzir erros e esforço manual.

- Dado um dispositivo cadastrado e autenticado, então suas leituras entram nos registros do equipamento correspondente, identificadas como automáticas. \[api\]
- Dado uma leitura duplicada ou fora de ordem, então ela é tratada sem gerar registro repetido. \[api\]
- Dado um dispositivo que deixa de enviar dados por tempo acima do limite, então o RT recebe alerta de falha de comunicação. \[api\]
- Dado uma leitura fora da faixa, então o fluxo de não conformidade é aberto como nos registros manuais. \[api\]
- Dado credenciais de dispositivo, então cada uma vale para um único tenant e pode ser revogada. \[seg\]

**US-INT-04 · Balanças e bioimpedância (P2)**

Como nutricionista, quero importar medidas de equipamentos, para não digitar valores.

- Dado uma medida recebida do equipamento, então ela aparece para confirmação antes de entrar na ficha do paciente. \[e2e\]
- Dado valores fora de faixa plausível, então o sistema pede revisão. \[unit\]

### 13.4 Assistente com IA

**US-IA-01 · Rascunho de cardápio ou plano (P1)**

Como nutricionista, quero um rascunho gerado a partir das metas e restrições, para ganhar tempo sem perder o controle.

- Dado metas e restrições do paciente (alergias, preferências, condições relevantes), então o assistente sugere um rascunho identificado como “gerado por IA”. \[ia\]
- Dado o rascunho, então todos os valores nutricionais são calculados pelo motor determinístico da plataforma a partir da base de alimentos, e não informados pelo modelo. \[unit\]
- Dado alergias ou restrições informadas, então o rascunho não inclui alimentos que as violam, validado por checagem automática independente do modelo. \[ia\]
- Dado o rascunho, então ele só vira plano oficial depois de revisão e aprovação do profissional. \[e2e\]
- Dado a aprovação, então o histórico indica que houve origem de IA e quem aprovou. \[api\]

**US-IA-02 · Sugestão de substituições (P1)**

Como nutricionista, quero sugestões de substituição equivalentes, para oferecer variedade ao paciente.

- Dado um alimento do plano, então as sugestões respeitam restrições e mostram a diferença de calorias e macros calculada pelo motor. \[ia\]
- Dado uma sugestão fora da tolerância definida, então ela aparece com aviso. \[unit\]

**US-IA-03 · Análise do diário alimentar (P2)**

Como nutricionista, quero um resumo do diário, para focar no que importa na consulta.

- Dado um período de registros, então o assistente resume padrões (horários, omissões, aderência) e aponta pontos de atenção. \[ia\]
- Dado o resumo, então ele não emite diagnóstico nem recomendação clínica, apenas observações para o profissional. \[ia\]
- Dado texto no diário que tente instruir o assistente (injeção de prompt), então as instruções são ignoradas e o conteúdo é tratado apenas como dado. \[seg\] \[ia\]

**US-IA-04 · Resumo de consulta (P2)**

Como nutricionista, quero transformar minhas anotações em um resumo organizado, para registrar mais rápido.

- Dado anotações do profissional, então o resumo é gerado como rascunho editável, que só é salvo no prontuário após aprovação. \[e2e\]
- Dado o resumo, então ele não acrescenta informações que não estavam nas anotações. \[ia\]

**US-IA-05 · Governança de dados e consentimento (P1)**

Como titular, quero controlar o uso de IA com dados dos meus pacientes, para cumprir a LGPD.

- Dado o tenant, então o recurso de IA vem desativado por padrão e exige ativação explícita pelo titular. \[e2e\]
- Dado a ativação, então o consentimento do paciente para tratamento com IA é registrado quando dados dele são usados. \[api\]
- Dado o envio ao provedor de IA, então dados que identificam o paciente (nome, documento, contato) são removidos ou substituídos sempre que não forem necessários. \[seg\]
- Dado o contrato com o provedor, então os dados enviados não são usados para treinar modelos. \[seg\]
- Dado o uso, então ficam registrados quem usou, quando e com qual finalidade, sem armazenar o conteúdo nos logs de uso. \[api\]
- Dado limites por plano, então o consumo de IA por tenant é medido e limitado, com aviso ao se aproximar do teto. \[api\]
- Dado uma falha ou lentidão do provedor, então o sistema mostra mensagem clara e o restante da plataforma continua funcionando. \[api\]

**US-IA-06 · Avaliação contínua de qualidade (P1)**

Como equipe de produto, quero medir a qualidade do assistente, para liberar mudanças com segurança.

- Dado um conjunto fixo de casos de avaliação (perfis, metas, restrições), então cada mudança de modelo ou de instruções roda esse conjunto no pipeline. \[ia\]
- Dado a meta de aceitação definida (por exemplo, zero violações de alergia nos casos e 100% dos valores nutricionais vindos do motor), então a liberação é bloqueada se não for atingida. \[ia\]
- Dado o feedback do profissional (útil, inadequado), então ele é coletado e revisado periodicamente. \[e2e\]
- Dado o rodapé das telas de IA, então há aviso de que o conteúdo é sugestão e exige revisão profissional. \[e2e\]

### 13.5 App móvel e modo offline

**US-MOB-01 · App para a equipe de cozinha (P1)**

Como Operador, quero um app para registros do dia a dia, para trabalhar sem depender de conexão.

- Dado o app instalado, então faço login com credenciais e, se disponível, biometria do aparelho. \[mob\]
- Dado que estou sem conexão, então consigo preencher checklists, temperaturas e recebimentos, e os dados sincronizam ao reconectar. \[mob\]
- Dado o armazenamento local, então os dados no aparelho ficam cifrados. \[seg\] \[mob\]
- Dado a perda do aparelho, então o titular pode encerrar a sessão remotamente e os dados locais são apagados no próximo acesso. \[seg\]

**US-MOB-02 · Sincronização e conflitos (P1)**

Como Operador, quero que meu trabalho offline nunca se perca, para confiar no app.

- Dado dois dispositivos editando o mesmo registro aberto, então o conflito é resolvido pela regra definida e ambos os autores ficam registrados. \[mob\]
- Dado um registro já fechado, então nenhuma sincronização atrasada o sobrescreve; ela gera retificação ou é recusada com aviso. \[api\]
- Dado uma sincronização interrompida no meio, então ao retomar não há duplicatas nem perdas. \[mob\]

**US-MOB-03 · Scanner e câmera (P2)**

Como Operador, quero ler códigos de barras e tirar fotos no app, para registrar mais rápido.

- Dado a leitura de um código cadastrado, então o item é preenchido automaticamente. \[mob\]
- Dado uma foto tirada, então ela é comprimida e enviada, e fica anexada ao registro correto. \[mob\]

### 13.6 API pública e webhooks

**US-API-01 · Chaves de API e escopos (P1)**

Como titular, quero gerar chaves de acesso, para integrar meus sistemas com segurança.

- Dado a criação de uma chave, então ela é exibida uma única vez e armazenada apenas de forma protegida (hash). \[seg\]
- Dado escopos escolhidos (por exemplo, leitura de agenda, escrita de pacientes), então a chave só faz o que foi permitido. \[seg\]
- Dado que revogo uma chave, então ela deixa de funcionar imediatamente. \[api\]
- Dado qualquer chave, então ela só enxerga dados do tenant que a criou. \[seg\]

**US-API-02 · Estabilidade, limites e versionamento (P1)**

Como desenvolvedor integrador, quero uma API previsível, para não quebrar minhas integrações.

- Dado um excesso de requisições, então a API responde com o código apropriado e informa quando tentar de novo. \[api\]
- Dado uma nova versão, então a anterior continua funcionando por um prazo anunciado. \[api\]
- Dado o contrato publicado, então testes de contrato validam respostas e códigos de erro a cada release. \[api\]
- Dado listas grandes, então a paginação é consistente e sem registros repetidos ou perdidos. \[api\]

**US-API-03 · Webhooks (P1)**

Como desenvolvedor integrador, quero ser avisado de eventos, para sincronizar sistemas.

- Dado um evento assinado (por exemplo, consulta criada ou pagamento confirmado), então a plataforma envia a notificação ao endereço cadastrado. \[api\]
- Dado a notificação, então ela vem assinada para que o receptor valide a origem. \[seg\]
- Dado falha no destino, então há novas tentativas com intervalo crescente e o receptor pode tratar repetições com segurança (idempotência). \[api\]
- Dado a carga do evento, então ela não contém conteúdo clínico por padrão. \[seg\]

**US-API-04 · Documentação e ambiente de testes (P2)**

Como desenvolvedor integrador, quero documentação e um ambiente de testes, para integrar sem risco.

- Dado o ambiente de testes, então ele usa dados sintéticos e chaves separadas das de produção. \[seg\]
- Dado a documentação, então ela é gerada a partir do contrato e fica sempre em sincronia com a API. \[api\]

### 13.7 White-label e redes

**US-WHL-01 · Marca própria (P1)**

Como titular de clínica ou rede, quero usar minha marca, para uma experiência coerente com meu negócio.

- Dado logo, cores e nome, então portal do paciente, e-mails e PDFs usam a minha identidade. \[e2e\]
- Dado um domínio próprio, então o portal responde nele com certificado TLS válido e renovação automática. \[e2e\]
- Dado o domínio personalizado, então ele só serve conteúdo do meu tenant. \[seg\]

**US-WHL-02 · Isolamento de marcas (P1)**

Como dono da plataforma, quero garantir que uma marca nunca apareça para outro cliente, para evitar vazamento de informação e confusão.

- Dado dois tenants com marcas diferentes, então nenhum e-mail, PDF ou tela de um exibe elementos do outro. \[e2e\]
- Dado cookies e sessões, então eles não são compartilhados entre domínios de tenants diferentes. \[seg\]

**US-ORG-01 · Rede com várias contas (P2)**

Como gestor de rede ou franquia, quero uma visão consolidada, para gerir várias unidades.

- Dado uma organização com várias unidades, então o gestor vê indicadores agregados de produção e de gestão. \[e2e\]
- Dado dados clínicos de pacientes, então eles continuam visíveis apenas aos profissionais da unidade, salvo autorização explícita registrada. \[seg\]
- Dado a cobrança, então ela pode ser consolidada na organização, com detalhamento por unidade. \[api\]

### 13.8 Painel do dono — versão completa

**US-ADM-06 · Métricas do negócio (P1)**

Como dono da plataforma, quero acompanhar a saúde do negócio, para decidir preços e investimento.

- Dado o painel, então vejo MRR, novos clientes, cancelamentos (de clientes e de receita), ARPU, conversão de trial para pago e total de pacientes na plataforma. \[e2e\]
- Dado cada métrica, então sua definição está documentada na própria tela. \[e2e\]
- Dado as faturas pagas e canceladas em um período de teste, então os valores do painel conferem com o somatório das faturas em reconciliação automatizada. \[unit\]

**US-ADM-07 · Alertas de uso e oportunidades (P1)**

Como dono da plataforma, quero ser avisado de situações relevantes, para agir antes de perder receita.

- Dado um tenant a 90% do limite de pacientes, então ele aparece na lista de oportunidade de upgrade. \[api\]
- Dado um tenant sem acesso há mais de N dias, então ele aparece na lista de risco de cancelamento. \[api\]
- Dado um pagamento em atraso, então ele aparece na lista de inadimplência. \[api\]
- Dado qualquer alerta, então posso enviar uma mensagem ao titular a partir do painel, e o envio fica registrado. \[e2e\]

**US-ADM-08 · Feature flags por tenant (P1)**

Como dono da plataforma, quero liberar recursos para grupos específicos, para testar antes de abrir a todos.

- Dado uma flag ativada para um tenant, então só ele vê o recurso. \[api\]
- Dado a desativação, então o recurso some sem perda de dados criados nesse período. \[api\]
- Dado a mudança, então ela é registrada na auditoria do super-admin. \[api\]

**US-ADM-09 · Comunicação segmentada (P2)**

Como dono da plataforma, quero enviar avisos por segmento, para comunicar novidades e manutenções.

- Dado segmentos por plano, faixa de pacientes, módulo ou status, então o aviso chega apenas ao público escolhido, dentro da plataforma e por e-mail. \[e2e\]
- Dado a opção de cancelar o recebimento de comunicados comerciais, então ela é respeitada. \[api\]

**US-ADM-10 · Modo suporte com consentimento (P2)**

Como dono da plataforma, quero ajudar um cliente com um problema, para resolver sem pedir capturas de tela, sem ter acesso permanente a nada.

- Dado que o nutricionista libera o suporte, então é gerado um acesso temporário, com prazo curto e escopo limitado, que ele pode revogar a qualquer momento. \[seg\]
- Dado o modo suporte, então dados que identificam pacientes aparecem mascarados e conteúdo clínico não é exibido. \[seg\]
- Dado o acesso, então cada ação do suporte é registrada e o nutricionista vê o histórico completo. \[api\]
- Dado que não houve liberação, então o super-admin não consegue entrar na conta do cliente em nenhuma circunstância. \[seg\]
- Dado o fim do prazo ou a revogação, então o acesso termina imediatamente. \[api\]

**US-ADM-11 · Encerramento e exportação do tenant (P1)**

Como dono da plataforma, quero um processo de saída bem definido, para cumprir a lei e tratar bem quem cancela.

- Dado o cancelamento, então o titular pode exportar todos os dados da conta (pacientes, planos, registros de qualidade) em formato aberto, em arquivo disponível apenas para ele. \[api\]
- Dado o prazo de retenção definido, então depois dele os dados são excluídos ou anonimizados e a conclusão é registrada. \[api\]
- Dado o processo, então o super-admin vê apenas o status (solicitado, gerado, entregue, excluído), nunca o conteúdo. \[seg\]

### 13.9 Critérios de saída, definição de pronto e automação

**Critérios de saída (por bloco, na liberação a clientes)**

- Histórias P1 do bloco aceitas e automatizadas, com piloto fechado concluído.
- Suítes de isolamento (tenant, unidade, paciente e super-admin) ampliadas para os novos recursos e passando.
- Para IA: conjunto de avaliação aprovado, governança de dados ativa e revisão jurídica dos termos.
- Para API e webhooks: testes de contrato, limites de uso e documentação publicados.
- Para integrações: modo de teste (sandbox) validado e plano de contingência para falha do parceiro.

**Mapa de automação sugerido**

- **Unitários:** reconciliação de métricas, indicadores dos dashboards, checagens de alérgenos, cálculos usados pela IA.
- **API e integração:** escopos e chaves, limites de uso, assinatura e reentrega de webhooks, sincronização com terceiros usando simuladores.
- **IA:** conjunto de casos de avaliação, testes de injeção de prompt, verificação de que valores nutricionais vêm do motor e de que restrições são respeitadas.
- **Mobile:** modo offline, sincronização com conflito, perda e recuperação do aparelho.
- **E2E (poucos e estáveis):** gerar o dossiê de auditoria, conectar o WhatsApp em ambiente de teste, aprovar um rascunho de IA, criar uma chave de API e consumir um webhook, ativar e revogar o modo suporte.

**Dicas**

- Use simuladores (mocks) dos parceiros em quase todos os testes; reserve poucos testes reais contra o ambiente de testes de cada fornecedor.
- Rode a avaliação da IA como etapa obrigatória do pipeline sempre que trocar de modelo, de instruções ou de provedor.
- Defina desde o início métricas de custo por tenant (IA, WhatsApp, armazenamento), para que a precificação cubra o consumo.
- Planeje a Fase 4 como uma sequência de lançamentos pequenos, medindo adoção e satisfação antes de investir no próximo bloco.

## 14. Roadmap consolidado, estimativas e dependências

**Premissas das estimativas**

- Equipe base: 2 a 3 pessoas de desenvolvimento, 1 pessoa de QA/análise e design em meio período.
- As estimativas incluem testes automatizados e correções, mas não incluem aquisição de clientes, suporte nem trâmites jurídicos.
- Todos os prazos são faixas iniciais. Revise-os ao fim da Fase 0, quando houver velocidade real medida da equipe. Considere uma folga de 20% a 30% sobre o total.
- Semana de calendário, não de esforço: férias, feriados e imprevistos entram na folga.

### 14.1 Visão geral por fase

**Fase 0 · Fundação (4 a 6 semanas)**

- Entrega: contas, 2FA, planos e cobrança, base de alimentos, LGPD, painel do dono v0, esteira de qualidade.
- Vende: nada ainda. É a base técnica e legal.

**Fase 1 · MVP clínico (8 a 12 semanas)**

- Entrega: pacientes, agenda, anamnese e avaliação, plano alimentar com PDF, financeiro básico, painel do dono v1 com limites de plano.
- Vende: **plano Clínico** (cobrança por faixa de pacientes), em beta fechado.

**Estabilização e piloto (3 a 4 semanas)**

- Entrega: correções, desempenho, onboarding, importação de planilha, material de suporte, piloto com 5 a 10 nutricionistas.
- Vende: abre a venda do plano Clínico a mais clientes após o gate G1.

**Fase 2 · Clínico avançado (6 a 10 semanas)**

- Entrega: portal e app do paciente, diário alimentar, chat, modelos de plano, suplementos e exames, TMB e GET.
- Vende: plano **Clínico Plus**, ou um adicional do Clínico, para quem quer engajar pacientes.

**Fase 3 · Produção e qualidade (10 a 14 semanas)**

- Entrega: fichas técnicas, cardápios, produção, estoque, checklists, controles, não conformidades, documentos e rastreabilidade.
- Vende: módulo **Produção/Qualidade**, cobrado por unidade ou usuário, e o **Combo**.

**Fase 4 · Diferenciais e escala (blocos de 2 a 12 semanas)**

- Entrega: dashboards, auditoria, integrações, IA, app móvel, API, white-label, painel do dono completo.
- Vende: planos superiores e **Enterprise** (redes, franquias, marca própria).

### 14.2 Dependências entre fases e módulos

**Dependências obrigatórias**

- A **Fase 0** vem antes de tudo: sem contas, tenants, limites e isolamento testado, nada mais é seguro de construir.
- A **Fase 1** depende da base de alimentos, dos planos e da cobrança da Fase 0.
- A **Fase 2** depende da Fase 1: o portal exibe planos alimentares, agenda e pacientes que só existem depois dela.
- A **Fase 3** depende da Fase 0 e reaproveita o motor de cálculo nutricional, a base de alimentos e a infraestrutura de permissões. **Ela não depende da Fase 2.**

**Dependências dentro da Fase 4**

- **Dashboards:** precisam dos dados da Fase 1 (clínico) e da Fase 3 (produção).
- **IA:** precisa do motor de cálculo da Fase 1 e do diário alimentar da Fase 2; também exige a governança de dados (US-IA-05) pronta antes de qualquer lançamento.
- **App móvel offline:** só faz sentido depois da Fase 3, porque o foco é checklists, controles e recebimento.
- **Dossiê de auditoria:** depende de checklists, temperaturas, não conformidades e documentos da Fase 3.
- **Integração com termômetros:** depende dos controles de temperatura da Fase 3.
- **WhatsApp:** depende da agenda e dos lembretes da Fase 1.
- **API e webhooks:** dependem de a Fase 1 estar estável; a API deve nascer sobre modelos de dados que não mudarão com frequência.
- **White-label:** depende do portal do paciente (Fase 2) e da infraestrutura de domínios e certificados.
- **Painel do dono completo:** depende da cobrança (Fase 0) e da contagem de uso (Fases 1 e 2); o modo suporte só deve vir depois dos testes de isolamento ampliados.

**Caminho crítico (o que mais atrasa o projeto se escorregar)**

- Isolamento de tenant e permissões, porque todas as fases usam.
- Motor de cálculo nutricional, porque Fases 1, 2, 3 e a IA dependem dele.
- Cobrança e limites de plano, porque sem eles não há receita nem painel confiável.
- Revisões jurídicas (termos, consentimento, retenção), porque podem travar lançamentos.

### 14.3 Cenários de cronograma

**Cenário A · Uma equipe, em sequência**

- Fase 0, Fase 1, estabilização e piloto, Fase 2 e Fase 3, nessa ordem.
- Total até o fim da Fase 3: cerca de **31 a 46 semanas** (aproximadamente 7 a 11 meses).
- Vantagem: menos risco de qualidade e de dispersão. Desvantagem: o módulo de Produção só chega ao mercado no fim.

**Cenário B · Duas equipes depois da Fase 1**

- Uma equipe segue com a Fase 2 e outra constrói a Fase 3 em paralelo, após a estabilização.
- Total até o fim da Fase 3: cerca de **25 a 36 semanas** (aproximadamente 6 a 8 meses), com 4 a 6 pessoas.
- Vantagem: chega mais cedo ao Combo e atende os dois públicos. Desvantagem: exige mais gente, mais coordenação e atenção para não duplicar infraestrutura.

**Cenário C · Produção primeiro**

- Possível porque a Fase 3 não depende da Fase 2. Faz sentido se as entrevistas mostrarem que a dor e a disposição de pagar estão no lado de produção.
- Risco: o motor de cálculo precisa nascer pensado para fichas técnicas, não só para planos alimentares.

**Recomendação**

- Comece pelo Cenário A e decida entre Fase 2 e Fase 3 no gate G1, com dados do piloto: retenção dos nutricionistas clínicos, pedidos de recursos e interesse real em produção.
- Só adote o Cenário B se houver caixa ou parceria que sustente duas equipes sem perder qualidade.

### 14.4 Marcos e critérios de decisão (gates)

Os números abaixo são pontos de partida e devem ser ajustados à sua realidade.

**G0 · Fim da Fase 0**

- Critérios de saída da seção 10 cumpridos.
- Velocidade da equipe medida e estimativas das próximas fases revisadas.
- Decisão: seguir para a Fase 1 ou ajustar escopo e prazo.

**G1 · Fim do piloto do MVP clínico**

- Nenhum incidente de isolamento de dados no piloto.
- Boa parte dos pilotos (por exemplo, 60% ou mais) cria planos alimentares reais e usa a agenda.
- Parte dos pilotos aceita pagar após o período gratuito (defina a meta antes de começar).
- Lista dos recursos mais pedidos para decidir entre Fase 2 e Fase 3.
- Decisão: abrir a venda, escolher a próxima fase e fixar preços e faixas.

**G2 · Fim da Fase 2**

- Adoção do portal pelos pacientes dos pilotos e impacto em retenção.
- Auditoria de notificações e privacidade aprovada.
- Decisão: priorizar blocos da Fase 4 ou acelerar a Fase 3.

**G3 · Fim da Fase 3**

- Piloto com pelo menos 3 cozinhas ou UAN com uso rotineiro de checklists e temperaturas.
- Dossiê de fiscalização revisado por um profissional da área.
- Decisão: lançar o módulo Produção e o Combo.

**G4 · Em cada bloco da Fase 4**

- Piloto fechado concluído e critérios de saída da seção 13 atendidos.
- Para IA: conjunto de avaliação aprovado e revisão jurídica concluída.

### 14.5 Sequência sugerida dos blocos da Fase 4

Os prazos abaixo são estimativas por bloco, já incluindo testes.

**Primeiro: retenção e receita**

- Painel do dono completo, sem o modo suporte (4 a 6 semanas), para métricas, alertas e feature flags.
- Dashboards do consultório e da produção (3 a 5 semanas).
- WhatsApp oficial (2 a 4 semanas).

**Segundo: valor para o módulo Produção**

- Dossiê de auditoria (3 a 4 semanas).
- App móvel com modo offline (8 a 12 semanas), se a Fase 3 tiver adoção.
- Integração com termômetros e dataloggers (4 a 6 semanas), depois de haver clientes pedindo.

**Terceiro: diferenciais**

- Assistente com IA (8 a 12 semanas, incluindo governança e avaliação), só depois de o motor de cálculo e o diário alimentar estarem estáveis.
- Google Agenda (2 a 3 semanas) e balanças (2 a 4 semanas), conforme demanda.

**Quarto: escala e canais**

- API pública e webhooks (4 a 6 semanas).
- White-label (4 a 6 semanas) e organização com várias contas (4 a 6 semanas), se houver clínicas e redes interessadas.
- Modo suporte com consentimento (2 a 3 semanas), depois de a suíte de isolamento cobrir todos os recursos.

### 14.6 O que cortar se o prazo apertar

Em vez de atrasar as datas, corte escopo, nesta ordem:

- Primeiro, as histórias **P2** de cada fase.
- Depois, recursos de conforto (importação por planilha, gráficos de evolução, modelos avançados) que não impedem o uso.
- Por último, nunca corte: isolamento entre tenants, permissões, auditoria, cálculos nutricionais corretos, cobrança e limites, backup e LGPD.

**Escopo mínimo da Fase 1 (se for necessário reduzir)**

- Cadastro e busca de pacientes, agenda simples sem lembretes, anamnese com um modelo padrão, plano alimentar com PDF, e cobrança manual de consultas.

**Escopo mínimo da Fase 3**

- Fichas técnicas, checklists e controle de temperaturas com não conformidades. Estoque, rastreabilidade e documentos podem vir em uma segunda entrega.

### 14.7 Riscos de cronograma e como reduzi-los

- **Subestimar o motor de cálculo e a base de alimentos:** reserve tempo para validar fontes, casos de referência e tolerâncias já na Fase 0.
- **Mudanças de escopo vindas do piloto:** registre pedidos, avalie no gate e evite encaixar recursos no meio da fase.
- **Dependência de terceiros (gateway, WhatsApp, provedor de IA, Google):** use simuladores nos testes, tenha plano B e comece as aprovações cedo, pois algumas levam semanas.
- **Revisão jurídica atrasada:** envie termos, consentimentos e regras de retenção ao advogado no começo da Fase 0, não no fim.
- **Equipe pequena com muitos módulos:** mantenha o princípio de lançamentos pequenos e não abra duas frentes sem pessoas para sustentá-las.
- **Qualidade deixada para depois:** mantenha a esteira de testes e as suítes de isolamento como parte da definição de pronto de cada história.

### 14.8 Próximos passos para os primeiros 30 dias

> Revisado na seção 15.8.

- **Semana 1:** fechar o público do piloto (5 a 10 nutricionistas clínicos e 3 a 5 de produção) e agendar entrevistas.
- **Semana 1 e 2:** decidir stack, modelo multi-tenant (conta, unidade, profissional, paciente) e a regra de “paciente ativo”.
- **Semana 2:** enviar ao advogado os rascunhos de termos de uso, política de privacidade, contrato de tratamento de dados e consentimento do paciente.
- **Semana 2 e 3:** prototipar telas essenciais (plano alimentar, agenda, painel do dono) e testá-las com os entrevistados.
- **Semana 3 e 4:** montar o repositório, o pipeline de integração contínua, os ambientes e os dois tenants sintéticos de teste, com a suíte de isolamento rodando desde o primeiro commit.
- **Semana 4:** começar a Fase 0, com os critérios de aceite da seção 10 já convertidos em tarefas rastreáveis.

*Estimativas e gates são referências de planejamento. Ajuste-os com a velocidade real da equipe e com o que você aprender nas entrevistas e no piloto.*

## 15. Andamento da implementação (atualizado em 24/10/2026)

### 15.1 Resumo e legenda

| Fase | Escopo | Situação |
|---|---|---|
| 0 · Fundação | Contas, 2FA, planos e cobrança, base de alimentos, LGPD, painel do dono v0, esteira de qualidade | Código e testes escritos. **Gate G0 pendente** (seção 15.6) |
| 1 · MVP clínico | Pacientes, agenda, anamnese, plano alimentar, financeiro, painel v1 | **Parcial:** pacientes, limites do plano, consentimento e agenda feitos. Faltam anamnese, plano alimentar, financeiro e painel v1 |
| 2 · Clínico avançado | Portal do paciente, diário, chat, modelos, suplementos, TMB/GET | Não iniciada |
| 3 · Produção e qualidade | Fichas técnicas, cardápios, estoque, checklists, NCs, rastreabilidade | Não iniciada |
| 4 · Diferenciais | Dashboards, auditoria, integrações, IA, app, API, white-label | Não iniciada (existem apenas as rotinas agendadas e a base do painel) |

**O que "implementada" significa aqui:** código e testes automatizados escritos e revisados por leitura. **Nenhum teste foi executado em ambiente real**: o ambiente em que o código foi gerado não tinha Postgres nem o motor do Prisma, e `next build` nunca rodou. Só foi feita uma checagem de sintaxe dos arquivos TypeScript. Por isso as marcas são 🟡 (implementada, não verificada) e 🔶 (parcial), e nenhuma história está "aceita". A primeira tarefa do plano revisado é executar tudo e corrigir o que falhar.

### 15.2 O que existe hoje

| Área | Entrega |
|---|---|
| Arquitetura e isolamento | Modelo Conta → Unidade → Usuário/Vínculo; RLS em todas as tabelas de negócio; três papéis de banco (dono do schema, aplicação, painel do dono); painel sem permissão em nenhuma tabela clínica; funções `SECURITY DEFINER` para cadastro, login, convite, contadores e localização de lembretes |
| Contas e autenticação | Cadastro com trial de 14 dias, confirmação de e-mail, login com bloqueio por tentativas, sessões no servidor, recuperação de senha, 2FA por TOTP com códigos de recuperação, convite e remoção de equipe, papéis Titular/Profissional/Secretária |
| Super-admin | Login com senha + TOTP sempre obrigatórios, sessão de 15 minutos de inatividade, cookie separado, tudo auditado |
| Planos e cobrança | Planos como configuração, checkout, webhook do gateway idempotente com assinatura, upgrade/downgrade com ajuste proporcional, trial vencido, atraso e carência, aviso de mudança de preço |
| Base de alimentos | Importador CSV idempotente com relatório e conferência, busca sem acento com sinônimos, alimentos próprios com validação de consistência, medidas caseiras. **Testado só com dados sintéticos** |
| LGPD | Exportação de paciente cifrada com link que expira, exclusão e anonimização com prazo de guarda configurável, ledger de exclusões para pós-restore, política de retenção e backup (rascunho) |
| Painel do dono v0 | Lista, filtros e CSV de tenants, detalhe com uso, faturas e linha do tempo, suspender, reativar e estender trial, tudo sem dado clínico |
| Pacientes | Cadastro enxuto, CPF validado e com alerta de duplicidade, busca e filtros, arquivar/restaurar, edição, consentimento LGPD com alerta |
| Limites do plano | Contagem ao vivo com trava por tenant, avisos em 80% e 100% (plataforma e e-mail), bloqueio só de novos cadastros, upgrade imediato |
| Agenda | Fuso por conta, conflito com confirmação, reagendar e cancelar com histórico, lembretes por e-mail com tentativas e sem duplicidade, visão da secretária sem prontuário |
| Camada web | 51 rotas de API e 13 telas mínimas (login, cadastro, convite, painel, pacientes, agenda, painel do dono); CSRF, limite de requisições, matriz de permissões, cabeçalhos de segurança |
| Rotinas agendadas | `POST /api/jobs/reminders` e `POST /api/jobs/daily`, autenticadas por segredo. **O agendador (cron) ainda precisa ser configurado** |

**Tamanho atual:** 30 modelos de dados, cerca de 2.800 linhas de código de serviço, 350 de SQL e 3.500 de testes (279 blocos de teste em 22 arquivos).

### 15.3 Decisões tomadas durante a implementação

- **Stack definida:** TypeScript, Next.js 15 (App Router, rotas de API no próprio projeto), PostgreSQL 16, Prisma 6, Vitest e zod. Ainda sem Redis e sem Playwright.
- **Isolamento no banco:** a aplicação nunca conecta como dono do schema; o RLS vale mesmo se a aplicação esquecer um filtro. Um teste confere que os papéis de execução não são superusuário nem `BYPASSRLS`.
- **Sessão:** cookie HttpOnly e SameSite=Lax com sessão no servidor (só o hash do token é guardado), o que permite logout e remoção de membro com efeito imediato.
- **2FA:** TOTP implementado sem dependência externa (validado com os vetores da RFC 6238), com proteção contra reutilização do código. Segredo cifrado em repouso com uma chave da aplicação.
- **Cobrança:** carência de 7 dias após atraso; depois dela só novos cadastros são bloqueados. O acesso aos dados e a exportação nunca são bloqueados. Alterar o preço de um plano só vale para assinaturas vigentes na renovação.
- **Paciente ativo:** janela em dias configurada no plano (padrão 90). Consulta realizada conta como atividade.
- **Limite de pacientes:** lido ao vivo do plano e do banco, com trava por tenant contra cadastros simultâneos. Arquivar libera vaga; restaurar ocupa de novo.
- **Importação de alimentos:** CSV com ponto e vírgula e decimal com vírgula. "NA", vazio e "*" viram nulo (não informado); "Tr" (traços) vira zero. Importação recusada sem licença confirmada.
- **Agenda:** horários em UTC e exibição no fuso da conta; lembrete 24 h antes por padrão; até 3 tentativas com espera crescente; a secretária gerencia a agenda mas só enxerga nome, horário, profissional e situação.
- **Rotinas agendadas:** chamadas por HTTP com segredo compartilhado, para rodar em qualquer agendador.

### 15.4 Mudanças de escopo em relação ao plano original

- **Adiado:** cupons e plano anual (US-PLN-05, P2), anexos (US-PAC-05), importação por planilha (US-PAC-06), horários de atendimento e bloqueios (US-AGE-04). A importação por planilha deve **subir de prioridade**, porque a migração da base de pacientes é a principal barreira de troca de sistema (seção 4, Fase 1).
- **Acrescentado:** matriz de permissões central e teste de inventário que falha se uma rota ficar sem autenticação declarada; avisos de limite dentro da plataforma; rotinas agendadas por segredo; ledger de exclusões para restauração de backup; teste de restore (`scripts/test-restore.sh`).
- **Antecipado:** camada web e telas mínimas, para permitir teste ponta a ponta antes de continuar a Fase 1.

### 15.5 Rastreabilidade: história → código → testes

| Histórias | Código | Testes |
|---|---|---|
| AUT-01, AUT-02 | `src/auth/service.ts`, `prisma/sql/auth.sql` | `tests/security/auth.test.ts`, `tests/api/auth.test.ts` |
| AUT-03, AUT-04 | `src/auth/service.ts`, `totp.ts`, `admin.ts`, `src/crypto/secrets.ts` | `tests/security/recovery-2fa.test.ts`, `tests/unit/totp.test.ts`, `tests/api/admin.test.ts` |
| AUT-05 | `src/team/service.ts` | `tests/security/team.test.ts` |
| PLN-01 a 04 | `src/billing/` | `tests/security/billing.test.ts`, `tests/unit/limits.test.ts` |
| ALI-01 a 04 | `src/foods/` | `tests/security/foods.test.ts`, `tests/unit/foods.test.ts` |
| LGP-02, LGP-03 | `src/lgpd/service.ts` | `tests/security/lgpd.test.ts` |
| ADM-00, ADM-01 | `src/admin/panel.ts` | `tests/security/admin-panel.test.ts`, `tests/api/admin.test.ts` |
| SEC-01 | RLS em `prisma/sql/*.sql` | `tests/security/isolation.test.ts`, `tests/api/security.test.ts` |
| SEC-02 | `src/server/permissions.ts` | `tests/unit/server.test.ts`, `tests/api/security.test.ts` |
| PAC-01 a 04, ADM-02 | `src/patients/` | `tests/security/patients.test.ts`, `tests/api/patients.test.ts`, `tests/unit/patients.test.ts` |
| ADM-03 | `refresh_usage_counters()` em `prisma/sql/rls.sql` | `tests/security/isolation.test.ts`, `tests/security/billing.test.ts` |
| AGE-01 a 03, AGE-06 | `src/agenda/` | `tests/security/agenda.test.ts`, `tests/api/agenda.test.ts`, `tests/unit/agenda-time.test.ts` |

### 15.6 Critérios do gate G0: situação

| Critério (seção 10.7) | Situação | O que falta |
|---|---|---|
| Histórias P1 da Fase 0 aceitas e automatizadas | 🔶 | Executar os testes e corrigir; fechar as histórias parciais (15.7) |
| Suítes de isolamento e de super-admin no pipeline | 🟡 | Rodar o CI pela primeira vez; hoje o pipeline está escrito mas nunca executou |
| Importação de TACO e TBCA validada contra amostra | 🔶 | Obter os arquivos reais, confirmar as condições de uso e definir a amostra de referência. O formato do CSV real pode diferir do que o importador espera |
| Fluxo cadastro → trial → contratação → cobrança em staging com gateway em teste | 🔶 | Escolher o gateway (Asaas, Iugu ou Pagar.me), escrever o adaptador e a nota fiscal, criar o ambiente de staging |
| Restore de backup testado e documentado | ⬜ | Executar `scripts/test-restore.sh` e arquivar o relatório |
| Termos, política e DPA revisados por advogado | ⬜ | Enviar os rascunhos (inclui `docs/politica-retencao-backup.md` e o texto de consentimento do paciente) |

### 15.7 Histórias parciais e dívidas técnicas

**Histórias parciais (🔶)**
- **PLN-02:** gateway real e nota fiscal.
- **LGP-01:** exigir novo aceite quando a versão dos termos mudar.
- **LGP-03:** prazo de guarda do prontuário depende de orientação do CFN/CRN (hoje sem trava).
- **LGP-04:** exigir TLS na infraestrutura, cifrar campos clínicos com chave por tenant, executar o restore.
- **LGP-05:** auditar falhas de login e mudanças de permissão.
- **ENG-01:** relatório de cobertura com meta e testes de navegador (Playwright).
- **ENG-02:** ambientes dev, staging e produção separados.
- **ENG-03 (não iniciada):** monitoramento de erros e alertas sem dados de pacientes; plano de resposta a incidentes.
- **AGE-05:** o link da videochamada é informado manualmente; não é gerado.
- **SEC-03:** leitura de ficha é auditada; listagens e falhas de login ainda não.

**Dívidas técnicas**
- O papel da aplicação ainda lê a tabela de usuários (identidade global); restringir a funções.
- Limite de requisições em memória (por instância); trocar por Redis com mais de uma instância.
- Provedor real de e-mail (hoje só a interface; em produção o app se recusa a iniciar sem provedor).
- Chave de cifra única da aplicação; o plano prevê chaves por tenant para dados clínicos.
- CPF guardado só com dígitos, em texto; decidir se entra na cifra de campos sensíveis.
- Arquivar um paciente não cancela as consultas futuras (o lembrete é pulado, mas a consulta continua).
- Cancelar no instante exato em que o job envia pode, raramente, deixar sair um lembrete em andamento.
- Interface mínima: sem telas de equipe, cobrança, configurações da agenda e planos.

### 15.8 Plano revisado: próximos passos

**Passo 0 · Validação técnica (imediato, antes de qualquer código novo)**
- Subir Postgres, aplicar as migrações e os scripts SQL (`npm run db:setup`), rodar `npm test` e `next build`.
- Corrigir tudo o que falhar. Critério: pipeline de CI verde, com as suítes de isolamento e de permissões passando.
- Registrar o tempo gasto: é a primeira medida real de velocidade para recalibrar as estimativas (seção 14).

**Passo 1 · Fechar o gate G0**
- Itens da seção 15.6, na ordem: restore, dados reais de TACO/TBCA, escolha do gateway, ambientes (dev, staging, produção), monitoramento, envio dos rascunhos ao advogado.
- Configurar o agendador (cron) para as rotinas de lembretes e diária.

**Passo 2 · Núcleo clínico da Fase 1**
1. Anamnese e antropometria (US-ANA-01 a 03).
2. Plano alimentar com cálculo e PDF (US-PLA-01 a 04, 06 e 07), a funcionalidade que mais decide a compra.
3. Financeiro básico (US-FIN-01).
4. Importação de pacientes por planilha (US-PAC-06), promovida de P2.
5. Se o prazo permitir: gráficos de evolução e composição corporal (US-ANA-04 e 05), substituições (US-PLA-05), pacotes e resumo mensal (US-FIN-02 e 03), horários de atendimento (US-AGE-04), anexos (US-PAC-05).

**Passo 3 · Painel do dono v1**
- Métricas de negócio (MRR, cancelamentos, conversão de trial), gestão de planos e limites pela interface, cobrança dos tenants.

**Passo 4 · Interface e experiência**
- Telas que faltam (equipe, cobrança, configurações, planos), revisão de usabilidade com 5 a 10 nutricionistas e protótipos do plano alimentar, que é a tela mais crítica.
- As entrevistas com nutricionistas previstas na seção 8 não estão registradas nesta conversa; confirmar se já ocorreram.

**Passo 5 · Estabilização, piloto e gate G1** (como na seção 14).

**Estimativas:** mantidas como faixas do plano original até que o Passo 0 produza uma velocidade medida. O ritmo em que o código foi escrito até aqui não serve de base para prazos, porque não houve execução, depuração nem validação com usuários.

### 15.9 Riscos novos

- **Código sem execução acumulado:** quanto mais se escreve antes de rodar, maior o custo de corrigir. Mitigação: Passo 0 antes de tudo.
- **Formato real das tabelas TACO/TBCA** pode diferir do importador. Mitigação: obter os arquivos cedo e adaptar o importador.
- **Interface mínima:** o produto só será avaliado por nutricionistas quando houver telas de plano alimentar e anamnese. Mitigação: priorizar o Passo 2 e a revisão de usabilidade.
- **Dependência de agendador externo** para lembretes e rotina diária: sem o cron, nenhum lembrete sai. Mitigação: configurar e monitorar no Passo 1.
- **Revisão jurídica ainda não iniciada:** pode travar o lançamento. Mitigação: enviar os rascunhos já no Passo 1.

*Atualize esta seção a cada marco: ao fechar o Passo 0, ao passar o gate G0 e a cada conjunto de histórias aceito.*

