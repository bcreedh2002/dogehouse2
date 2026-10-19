const {spawnSync}=require('node:child_process');
for(const file of ['site-config.cjs','orders.cjs','payments.cjs','payment-backend.cjs','owner-order.cjs','owner-access.cjs','orders-access.cjs','order-management.cjs','payments-access.cjs','launch-hardening.cjs']){
 const result=spawnSync(process.execPath,['tests/'+file],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
}
for(const file of ['pages.py','staging.py','netlify.py']){const result=spawnSync('python3',['tests/'+file],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
