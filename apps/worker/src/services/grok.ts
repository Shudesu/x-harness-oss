import { recordSpend, getMonthSpend } from '@x-harness/db';
import type { Env } from '../index.js';
export const MODEL_PRICES:Record<string,{input:number;cached:number;output:number}>={'grok-4.3':{input:1.25,cached:.20,output:2.5},'grok-4.7':{input:2,cached:.5,output:6}};
export type AiUsage={inputTokens:number;outputTokens:number;cachedTokens:number;xPostsFetched:number;xUsersFetched:number};
export class AiBudgetExceededError extends Error {constructor(){super('AI monthly budget reached');this.name='AiBudgetExceededError';}}
export function isGrokEnabled(env:Env['Bindings']){return !!env.XAI_API_KEY;}
export function calculateAiCost(model:string,u:AiUsage) {
  const p=MODEL_PRICES[model]; if(!p) throw new Error('Unsupported AI model');
  const factor=u.inputTokens>=200000?2:1;
  return factor*((u.inputTokens-u.cachedTokens)*p.input+u.cachedTokens*p.cached+u.outputTokens*p.output)/1e6+u.xPostsFetched*.005+u.xUsersFetched*.01;
}
export class GrokClient {
  constructor(private env:Env['Bindings'],private accountId:string,private feature:string){}
  async respond(args:{model?:string;input:unknown;tools?:unknown[];maxTurns?:number;jsonSchema?:Record<string,unknown>}) {
    if(!isGrokEnabled(this.env)) throw new Error('AI not configured');
    const rows=(await this.env.DB.prepare("SELECT key,value FROM settings WHERE key IN ('xai_model','xai_monthly_budget_usd')").all<{key:string;value:string}>()).results;
    const settings=Object.fromEntries(rows.map(r=>[r.key,r.value]));
    const model=args.model ?? settings.xai_model ?? this.env.XAI_MODEL ?? 'grok-4.3';
    if(!MODEL_PRICES[model]) throw new Error('Unsupported AI model');
    const budget=Number(settings.xai_monthly_budget_usd ?? this.env.XAI_MONTHLY_BUDGET_USD ?? 5);
    if(!Number.isFinite(budget)||budget<0) throw new Error('Invalid AI budget');
    if(JSON.stringify(args.input).length>120000) throw new Error('AI input too large');
    const lock=await this.env.DB.prepare("INSERT INTO ai_locks(id,expires_at) VALUES ('ai-budget',?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at < ? RETURNING id").bind(Date.now()+180000,Date.now()).first();
    if(!lock) throw new Error('AI is busy; retry shortly');
    try {
      if(await getMonthSpend(this.env.DB,'xai')>=budget) throw new AiBudgetExceededError();
      let response:Response|undefined;
      for(let attempt=0;attempt<3;attempt++) {
        response=await fetch('https://api.x.ai/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.env.XAI_API_KEY}`},body:JSON.stringify({model,input:args.input,store:false,max_output_tokens:4096,...(args.tools?{tools:args.tools,max_turns:Math.min(args.maxTurns ?? 2,2)}:{}),...(args.jsonSchema?{text:{format:{type:'json_schema',name:'result',strict:true,schema:args.jsonSchema}}}:{})}),signal:AbortSignal.timeout(30000)});
        if(response.status!==429 && response.status<500) break;
        if(attempt<2) { await response.body?.cancel(); await new Promise(r=>setTimeout(r,500*2**attempt)); }
      }
      if(!response?.ok) throw new Error(`AI service unavailable (${response?.status ?? 'network'})`);
      const raw=await response.json() as any;
      const details=raw.usage?.server_side_tool_usage_details ?? {};
      const count=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:0;
      const usage:AiUsage={inputTokens:count(raw.usage?.input_tokens),outputTokens:count(raw.usage?.output_tokens),cachedTokens:count(raw.usage?.input_tokens_details?.cached_tokens),xPostsFetched:count(details.x_posts_fetched),xUsersFetched:count(details.x_users_fetched)};
      usage.cachedTokens=Math.min(usage.inputTokens,usage.cachedTokens);
      const costUsd=calculateAiCost(model,usage);
      await this.env.DB.prepare('INSERT INTO ai_runs(id,x_account_id,feature,model,input_tokens,output_tokens,cached_tokens,x_posts_fetched,x_users_fetched,cost_usd,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),this.accountId,this.feature,model,usage.inputTokens,usage.outputTokens,usage.cachedTokens,usage.xPostsFetched,usage.xUsersFetched,costUsd,new Date().toISOString()).run();
      const prices=MODEL_PRICES[model],factor=usage.inputTokens>=200000?2:1;
      const units:[string,number,number][]=[['ai_input_tokens',usage.inputTokens-usage.cachedTokens,prices.input*factor/1e6],['ai_cached_tokens',usage.cachedTokens,prices.cached*factor/1e6],['ai_output_tokens',usage.outputTokens,prices.output*factor/1e6],['x_posts_fetched',usage.xPostsFetched,.005],['x_users_fetched',usage.xUsersFetched,.01]];
      for(const [resourceType,count,price] of units)if(count)await recordSpend(this.env.DB,{accountId:this.accountId,feature:this.feature,endpoint:'/responses',resourceType,units:count,unitCost:price,source:'xai'});
      const text=(raw.output ?? []).filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content ?? []).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('\n');
      if(raw.status && raw.status!=='completed') throw new Error('AI response incomplete');
      let json:unknown; if(args.jsonSchema) { try{json=JSON.parse(text);}catch{throw new Error('Invalid AI JSON');} }
      return {text,json,usage,costUsd,model};
    } finally {await this.env.DB.prepare("DELETE FROM ai_locks WHERE id='ai-budget'").run();}
  }
}
