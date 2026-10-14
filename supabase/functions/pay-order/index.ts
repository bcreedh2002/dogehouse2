import {paymentBackend} from '../_shared/payment-backend.ts';
import {payHandler} from '../_shared/payments.ts';
const {backend}=paymentBackend();
Deno.serve(payHandler(backend));
