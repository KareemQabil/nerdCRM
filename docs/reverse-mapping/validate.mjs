/**
 * Pinned-source mapping consistency check.
 *
 * Covers repository manifests and source-symbol NAME existence only.
 * It cannot prove business semantics, AOP runtime behavior, security or product completeness.
 *
 * Run from repo root:
 *   node docs/reverse-mapping/validate.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
const dir=dirname(fileURLToPath(import.meta.url));
const root=resolve(dir,"../..");
const sourceDir=join(dir,"source-ledger");
const platformDir=join(dir,"platform-source-ledger");
const counts=JSON.parse(readFileSync(join(dir,"SOURCE_SCOPE_COUNTS.json"),"utf8"));
const modules=counts.modules.map(x=>x.name);
function csv(path){
 const lines=readFileSync(path,"utf8").trimEnd().split("\n");
 return lines.map(line=>{
  const out=[];let value="",quoted=false;
  for(let i=0;i<line.length;i++){
   const ch=line[i];
   if(ch==='"'){
    if(quoted && line[i+1]==='"'){value+='"';i++;}
    else quoted=!quoted;
   }else if(ch===","&&!quoted){out.push(value);value="";}
   else value+=ch;
  }
  if(quoted)throw new Error("Unclosed CSV quoted field in "+path);
  out.push(value);
  return out;
 });
}
const errors=[];
const paths=new Map();
let sourceRows=0,domain=0,views=0;
for(const module of modules){
 const filename=join(sourceDir,module+".csv");
 if(!existsSync(filename)){errors.push("Missing module source ledger "+module);continue;}
 const [header,...rows]=csv(filename);
 if(header[0]!=="module"||header[1]!=="source_path")errors.push("Invalid ledger header "+module);
 const bucket=new Set();
 for(const row of rows){
  if(row.length!==5||row[0]!==module){errors.push("Invalid row "+module);continue;}
  if(bucket.has(row[1]))errors.push("Duplicate source path "+row[1]);
  bucket.add(row[1]);sourceRows++;
  if(row[2]==="DOMAIN")domain++;
  if(row[2]==="VIEW")views++;
 }
 paths.set(module,bucket);
}
for(const [field,actual,expected] of [
 ["Tracked files",sourceRows,counts.trackedFiles],
 ["Domain files",domain,counts.domainXmlFiles],
 ["View files",views,counts.viewXmlFiles],
 ["Module count",modules.length,26],
]){
 if(actual!==expected)errors.push(field+" mismatch: "+actual+" vs "+expected);
}
const extras=[
 ["axelor-studio","4_0_7",1825],
 ["axelor-utils","4_0_2",494],
 ["open-suite-webapp","v9_1_10",56],
];
for(const [name,tag,expected] of extras){
 const file=join(platformDir,name+"-"+tag+".csv");
 if(!existsSync(file)){errors.push("Missing platform ledger "+name);continue;}
 const [, ...rows]=csv(file);
 if(rows.length!==expected)errors.push("Unexpected "+name+" row count: "+rows.length+" expected "+expected);
 paths.set(name,new Set(rows.map(r=>r[2])));
}
const aliases={
 account:"axelor-account",bankPayment:"axelor-bank-payment",base:"axelor-base",
 budget:"axelor-budget",cash:"axelor-cash-management",clientPortal:"axelor-client-portal",
 contract:"axelor-contract",crm:"axelor-crm",fleet:"axelor-fleet",
 gdpr:"axelor-gdpr",helpdesk:"axelor-helpdesk",hr:"axelor-human-resource",
 intervention:"axelor-intervention",maintenance:"axelor-maintenance",
 marketing:"axelor-marketing",mobile:"axelor-mobile-settings",
 production:"axelor-production",project:"axelor-project",purchase:"axelor-purchase",
 quality:"axelor-quality",sale:"axelor-sale",stock:"axelor-stock",
 supplierMgmt:"axelor-supplier-management",supplierPortal:"axelor-supplier-portal",
 supplychain:"axelor-supplychain",talent:"axelor-talent",studio:"axelor-studio",utils:"axelor-utils"
};
const matrices=["CAPABILITY_CORE_CRM_TRACE.csv","CAPABILITY_COMMERCIAL_OPERATIONS_TRACE.csv","CAPABILITY_SPECIALIZED_IOETI_TRACE.csv","CAPABILITY_PLATFORM_AND_GOVERNANCE_TRACE.csv"];
const seen=new Set();
let capCount=0, verified=0, skipped=0;
for(const file of matrices){
 const [header,...rows]=csv(join(dir,file));
 const get=name=>header.indexOf(name);
 for(const key of ["id","area","capability","upstream_source_symbols","priority","proof_status"]){
  if(get(key)<0)errors.push("Missing "+key+" in "+file);
 }
 for(const row of rows){
  const id=row[get("id")];
  if(seen.has(id))errors.push("Duplicate capability "+id);
  seen.add(id);capCount++;
  const raw=row[get("upstream_source_symbols")]||"";
  for(const symbol of raw.split(";")){
   if(symbol.trim()==="none"){skipped++;continue;}
   const [alias,name]=symbol.trim().split(":");
   if(!alias||!name){errors.push("Malformed source symbol "+id+" "+symbol);continue;}
   const repoName=aliases[alias];
   if(!repoName){if(alias==="ioeti"||alias==="AOP"||alias==="none"){skipped++;continue;}errors.push("Unknown alias "+id+" "+alias);continue;}
   const bucket=paths.get(repoName);
   if(!bucket){errors.push("No ledger "+repoName);continue;}
   const match=[...bucket].some(path=>path.endsWith("/"+name+".xml")||path.endsWith("/"+name+".java"));
   if(!match)errors.push("Unresolved pinned source symbol "+id+" "+symbol);
   else verified++;
  }
 }
}
if(capCount!==377)errors.push("Capability count changed; update and rebaseline check: "+capCount);
const contracts=JSON.parse(readFileSync(join(dir,"UI_API_SURFACE_CONTRACTS.json"),"utf8"));
const securityRows=csv(join(dir,"API_SECURITY_NEGATIVE_MATRIX.csv"));
const policyHeader=securityRows[0];
const policyCol=Object.fromEntries(policyHeader.map((v,i)=>[v,i]));
if(securityRows.length-1!==52)errors.push("Security matrix row count must match 52 UI routes");
const secSeen=new Set();
for(const fields of securityRows.slice(1)){
 const id=fields[policyCol.surface_id];
 if(secSeen.has(id))errors.push("Duplicate security matrix surface "+id);
 secSeen.add(id);
 if(!fields[policyCol.authorization_layers_required]||!fields[policyCol.security_acceptance])
   errors.push("Missing ACL/negative test "+id);
 if(!Array.isArray(contracts.surfaces)||!contracts.surfaces.some(x=>x.surface_id===id))
   errors.push("Security matrix references missing UI surface "+id);
}


if(!Array.isArray(contracts.surfaces))errors.push("UI contracts must contain surfaces array");
else {
 const surfaceIds=new Set();
 const allowed=new Set(["BASE_READONLY","BASE_IMPLEMENTED","DRAFT_PR8","PR6_SECURITY_DEPENDENCY","NOT_IMPLEMENTED"]);
 for(const surface of contracts.surfaces){
  if(surfaceIds.has(surface.surface_id))errors.push("Duplicate UI surface "+surface.surface_id);
  surfaceIds.add(surface.surface_id);
  if(!allowed.has(surface.state))errors.push("Invalid UI surface state "+surface.surface_id);
  if(!Array.isArray(surface.capability_ids)||!surface.capability_ids.length)
    errors.push("UI surface has no trace capabilities "+surface.surface_id);
  else for(const id of surface.capability_ids)if(!seen.has(id))
    errors.push("UI surface "+surface.surface_id+" references missing capability "+id);
  if(!surface.api_contract||!surface.interaction||!surface.negative_acceptance)
    errors.push("Incomplete UI/API/negative acceptance "+surface.surface_id);
  if(surface.state==="NOT_IMPLEMENTED" && surface.api_contract.startsWith("GET ")===false
      && surface.api_contract.startsWith("POST ")===false
      && surface.api_contract.startsWith("PUT ")===false)
    errors.push("Proposed API method missing "+surface.surface_id);
 }
 if(contracts.surfaces.length!==52)errors.push("UI surface trace count changed, review and rebaseline");
}

const localLedger=csv(join(dir,"IOETI_REPO_FILE_LEDGER.csv")).slice(1);
const localSeen=new Set(localLedger.map(x=>x[0]));
if(!localSeen.has("apps/ioeti-web/src/App.tsx"))errors.push("Missing IOETI frontend code baseline");
if(!localSeen.has("modules/ioeti-business-lines/src/main/resources/domains/BusinessLine.xml"))errors.push("Missing IOETI BusinessLine baseline");
if(errors.length){
 console.error("REVERSE_MAPPING=FAIL errors="+errors.length);
 for(const item of errors)console.error(" - "+item);
 process.exit(1);
}
console.log(JSON.stringify({status:"PASS",modules:modules.length,AOS_tracked_files:sourceRows,AOS_domain_xml:domain,AOS_view_xml:views,capabilities:capCount,ui_api_surfaces:contracts.surfaces?.length,negative_authorization_routes:securityRows.length-1,verified_pinned_symbol_occurrences:verified,external_or_local_unverified_symbol_occurrences:skipped,platform_manifest_repos:extras.map(x=>x[0])},null,2));
console.log("CAVEAT: This checks existence and structural mapping only. It does NOT verify runtime behavior or complete unprovided business requirements.");
