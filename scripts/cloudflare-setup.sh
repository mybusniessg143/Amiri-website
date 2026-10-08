#!/usr/bin/env bash
# One-command Cloudflare (and Resend) setup for the AI Receptionist enquiry back end.
#
# Safe to run more than once: it finds what already exists and only creates what is missing.
# By default the enquiry endpoint is switched ON for Preview deployments only and stays OFF
# on the live (Production) site. Run with --enable-production only after the owner approves.
#
# Needs (environment variables, never committed):
#   CLOUDFLARE_API_TOKEN   API token with: Account › D1 Edit, Account › Workers R2 Storage Edit,
#                          Account › Cloudflare Pages Edit, Zone › DNS Edit (amiribuildingservices.com),
#                          Zone › Zone Read
#   CLOUDFLARE_ACCOUNT_ID  optional; found automatically if the token sees one account
#   PAGES_PROJECT          optional; found automatically if the account has one Pages project
#   RESEND_API_KEY         optional; a Resend "Full access" key (needed to add the sending domain)
#
# Usage: scripts/cloudflare-setup.sh [--enable-production]
set -euo pipefail

DOMAIN="amiribuildingservices.com"
DB_NAME="amiri-enquiries"
BUCKET="amiri-enquiries"
EMAIL_TO="${EMAIL_TO:-waris@amiribuildingservices.com}"
EMAIL_FROM="${EMAIL_FROM:-Amiri Website <enquiries@amiribuildingservices.com>}"
PROD_ENABLED="false"
[ "${1:-}" = "--enable-production" ] && PROD_ENABLED="true"

API="https://api.cloudflare.com/client/v4"
: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cf() { # cf METHOD PATH [JSON]
  local m="$1" p="$2" d="${3:-}"
  if [ -n "$d" ]; then
    curl -sS -X "$m" "$API$p" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" --data "$d"
  else
    curl -sS -X "$m" "$API$p" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
  fi
}
# jq-free JSON helper: js '<expression using j>' < json
js() { local e="$1"; shift; node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);const r=($e);if(r!==undefined&&r!==null)console.log(typeof r==='string'?r:JSON.stringify(r));})" "$@"; }
ok() { js 'j.success ? "" : (()=>{console.error("Cloudflare error: "+JSON.stringify(j.errors));process.exit(1)})()'; }
step() { printf '\n== %s\n' "$*"; }

step "Checking the API token"
cf GET /user/tokens/verify | js 'j.success ? "token ok ("+j.result.status+")" : (console.error(JSON.stringify(j.errors)),process.exit(1))'

if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  CLOUDFLARE_ACCOUNT_ID="$(cf GET /accounts | js 'j.result.length===1 ? j.result[0].id : (console.error("Token sees "+j.result.length+" accounts; set CLOUDFLARE_ACCOUNT_ID: "+j.result.map(a=>a.name+"="+a.id).join(", ")),process.exit(1))')"
fi
ACC="/accounts/$CLOUDFLARE_ACCOUNT_ID"
echo "account: $CLOUDFLARE_ACCOUNT_ID"

step "Pages project"
PROJECTS="$(cf GET "$ACC/pages/projects")"
echo "$PROJECTS" | js 'j.result.map(p=>"- "+p.name+" ("+(p.source?p.source.type+" "+(p.source.config.repo_name||""):"direct upload")+", production branch "+p.production_branch+", "+(p.domains||[]).join(" ")+")").join("\n")'
if [ -z "${PAGES_PROJECT:-}" ]; then
  PAGES_PROJECT="$(echo "$PROJECTS" | js 'j.result.length===1 ? j.result[0].name : (console.error("Found "+j.result.length+" Pages projects; set PAGES_PROJECT"),process.exit(1))')"
fi
echo "using: $PAGES_PROJECT"

step "Domain and DNS ($DOMAIN)"
ZONE_ID="$(cf GET "/zones?name=$DOMAIN" | js 'j.result[0] ? j.result[0].id : (console.error("Zone not found in this account"),process.exit(1))')"
cf GET "/zones/$ZONE_ID/dns_records?per_page=200" | js 'j.result.map(r=>"- "+r.type.padEnd(6)+" "+r.name+" -> "+String(r.content).slice(0,70)).join("\n")'

step "D1 database ($DB_NAME)"
DB_ID="$(cf GET "$ACC/d1/database?name=$DB_NAME" | js '(j.result.find(d=>d.name==="'"$DB_NAME"'")||{}).uuid')"
if [ -z "$DB_ID" ]; then
  DB_ID="$(cf POST "$ACC/d1/database" "{\"name\":\"$DB_NAME\",\"primary_location_hint\":\"weur\"}" | js 'j.success ? j.result.uuid : (console.error(JSON.stringify(j.errors)),process.exit(1))')"
  echo "created $DB_ID"
else
  echo "exists $DB_ID"
fi
SQL="$(node -e 'console.log(JSON.stringify({sql:require("fs").readFileSync(process.argv[1],"utf8")}))' "$ROOT/migrations/0001_enquiries.sql")"
cf POST "$ACC/d1/database/$DB_ID/query" "$SQL" | ok && echo "table ready"

step "R2 bucket ($BUCKET)"
if cf GET "$ACC/r2/buckets/$BUCKET" | js 'j.success ? "" : process.exit(1)' >/dev/null 2>&1; then
  echo "exists"
else
  cf POST "$ACC/r2/buckets" "{\"name\":\"$BUCKET\",\"locationHint\":\"weur\"}" | ok && echo "created (private)"
fi
cf PUT "$ACC/r2/buckets/$BUCKET/lifecycle" '{"rules":[{"id":"delete-enquiries-after-12-months","enabled":true,"conditions":{"prefix":"enquiries/"},"deleteObjectsTransition":{"condition":{"type":"Age","maxAge":31536000}}}]}' | ok && echo "12-month deletion rule set"

step "Pages bindings and settings"
HAS_SECRET="$(cf GET "$ACC/pages/projects/$PAGES_PROJECT" | js 'Boolean(((j.result.deployment_configs.production||{}).env_vars||{}).FILE_LINK_SECRET)')"
SECRET_JSON=""
if [ "$HAS_SECRET" != "true" ]; then
  # Generated once and never printed; re-runs keep it so existing photo links keep working.
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))')"
  SECRET_JSON="\"FILE_LINK_SECRET\":{\"type\":\"secret_text\",\"value\":\"$SECRET\"},"
fi
RESEND_JSON=""
[ -n "${RESEND_API_KEY:-}" ] && RESEND_JSON="\"RESEND_API_KEY\":{\"type\":\"secret_text\",\"value\":\"$RESEND_API_KEY\"},"
config() { # config ENABLED EXTRA
  printf '{"d1_databases":{"DB":{"id":"%s"}},"r2_buckets":{"ENQUIRY_FILES":{"name":"%s"}},"env_vars":{%s%s"EMAIL_TO":{"type":"plain_text","value":"%s"},"EMAIL_FROM":{"type":"plain_text","value":"%s"},"ENQUIRY_API_ENABLED":{"type":"plain_text","value":"%s"}%s}}' \
    "$DB_ID" "$BUCKET" "$SECRET_JSON" "$RESEND_JSON" "$EMAIL_TO" "$EMAIL_FROM" "$1" "$2"
}
BODY="{\"deployment_configs\":{\"preview\":$(config true ',"AI_CHAT_PREVIEW":{"type":"plain_text","value":"1"}'),\"production\":$(config "$PROD_ENABLED" '')}}"
cf PATCH "$ACC/pages/projects/$PAGES_PROJECT" "$BODY" | ok
echo "Preview: endpoint ON, chat shown on preview links (AI_CHAT_PREVIEW=1)"
echo "Production: endpoint $( [ "$PROD_ENABLED" = true ] && echo ON || echo OFF ), chat follows aiChat.enabled in site.config.json"
echo "(Settings apply to the next deployment.)"

if [ -n "${RESEND_API_KEY:-}" ]; then
  step "Resend sending domain"
  RS() { curl -sS -X "$1" "https://api.resend.com$2" -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" ${3:+--data "$3"}; }
  RID="$(RS GET /domains | js '((j.data||[]).find(d=>d.name==="'"$DOMAIN"'")||{}).id')"
  [ -z "$RID" ] && RID="$(RS POST /domains "{\"name\":\"$DOMAIN\",\"region\":\"eu-west-1\"}" | js 'j.id || (console.error(JSON.stringify(j)),process.exit(1))')"
  RECORDS="$(RS GET "/domains/$RID")"
  echo "$RECORDS" | node -e '
    let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{for(const r of JSON.parse(s).records||[])console.log([r.type,r.name,r.value,r.priority||""].join("\t"));});' |
  while IFS=$'\t' read -r TYPE NAME VALUE PRIO; do
    FQDN="$NAME.$DOMAIN"; [ "$NAME" = "@" ] && FQDN="$DOMAIN"
    EXISTS="$(cf GET "/zones/$ZONE_ID/dns_records?type=$TYPE&name=$FQDN" | js 'j.result.some(r=>r.content.replace(/"/g,"")===process.argv[1])' "$VALUE" 2>/dev/null || echo false)"
    if [ "$EXISTS" = "true" ]; then echo "exists  $TYPE $FQDN"; continue; fi
    REC="$(node -e 'const [t,n,v,p]=process.argv.slice(1);const r={type:t,name:n,content:v,ttl:1,proxied:false,comment:"Resend (website enquiry emails)"};if(p)r.priority=Number(p);console.log(JSON.stringify(r))' "$TYPE" "$FQDN" "$VALUE" "$PRIO")"
    cf POST "/zones/$ZONE_ID/dns_records" "$REC" | ok && echo "added   $TYPE $FQDN"
  done
  RS POST "/domains/$RID/verify" >/dev/null && echo "verification started (Resend usually confirms within minutes)"
fi

step "Done"
echo "Next: push a branch (Preview deployment) and run a test enquiry on its preview link."
