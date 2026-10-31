import 'dotenv/config';
// Chave fixa só para testes. Em produção: openssl rand -base64 32 (gerenciador de segredos).
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.GATEWAY_WEBHOOK_SECRET ??= 'segredo-teste-api';
process.env.MAIL_DRIVER ??= 'memory';
process.env.JOB_SECRET ??= 'segredo-job-teste';
