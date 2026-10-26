export const campaignToolDefs = [{
 name:'create_campaign',
 description:'LINE先行キャンペーンの参加リンクを作成する。既存X告知投稿と署名連携済みLINE接続を指定。Xへの投稿・DMは行わない。',
 inputSchema:{type:'object' as const,properties:{
  xAccountId:{type:'string'},postId:{type:'string'},lineConnectionId:{type:'string'},title:{type:'string',maxLength:100},slug:{type:'string',pattern:'^[a-z0-9-]{2,64}$'},claimPhrase:{type:'string',minLength:2,maxLength:8},endsAt:{type:'string',description:'Timezone-qualified ISO date'},tier:{type:'string',enum:['simple','standard','strict']},awardMode:{type:'string',enum:['first_come','lottery']},requireFollow:{type:'boolean'},minAccountAgeDays:{type:'integer',minimum:0},minFollowers:{type:'integer',minimum:0},settleSec:{type:'integer',minimum:0,maximum:300},budgetUsd:{type:'number',minimum:0},postCostUsd:{type:'number',minimum:0},externalCostUsd:{type:'number',minimum:0},
  rewards:{type:'array',minItems:1,maxItems:10,items:{type:'object',properties:{label:{type:'string'},type:{type:'string',enum:['coupon_code','url','line_message','file']},value:{type:'string'},quota:{type:['integer','null'],minimum:0},weight:{type:'number',minimum:0},consolation:{type:'boolean'},codes:{type:'array',items:{type:'string'},maxItems:1000},unitCost:{type:'number',minimum:0}},required:['label','type','value','quota']}},
  scenarios:{type:'object',properties:{claimed:{type:'string'},won:{type:'string'},lost:{type:'string'}}},
 },required:['xAccountId','postId','lineConnectionId','title','slug','claimPhrase','endsAt','rewards']}
},{name:'get_gate_funnel',description:'キャンペーンの参加・判定・配布・LINE反応、計上済み費用と通知失敗を取得する。',inputSchema:{type:'object' as const,properties:{gateId:{type:'string'}},required:['gateId']}}];
