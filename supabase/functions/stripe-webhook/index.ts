import {paymentBackend} from '../_shared/payment-backend.ts';
import {webhookHandler} from '../_shared/payments.ts';
const {backend,live}=paymentBackend();
Deno.serve(webhookHandler(backend,Deno.env.get('STRIPE_WEBHOOK_SECRET')||'',live));
