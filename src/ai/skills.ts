import { dedupe } from "./normalize.ts";

/** One line per skill: canonical=alias,alias. Matching is word-bounded and case-insensitive. */
const dictionary = `
JavaScript=js,ecmascript,es6
TypeScript=ts
Python
Java
C#=csharp,c sharp
C++=cpp
Golang=go lang
Rust
Ruby
PHP
Swift
Kotlin
Scala
R programming=r language
MATLAB
Perl
Bash=shell scripting,shell
PowerShell
SQL
NoSQL
GraphQL
REST=restful,rest api,rest apis
gRPC
HTML=html5
CSS=css3
Sass=scss
React=react.js,reactjs
Next.js=nextjs
Redux
Vue=vue.js,vuejs
Angular=angularjs
Svelte
jQuery
Tailwind=tailwindcss,tailwind css
Webpack
Node.js=node,nodejs
Express=express.js,expressjs
NestJS=nest.js
Django
Flask
FastAPI
Spring Boot=springboot
Spring
.NET=dotnet,asp.net
Rails=ruby on rails
Laravel
React Native
Flutter
Android
iOS
AWS=amazon web services
Azure=microsoft azure
GCP=google cloud,google cloud platform
Docker
Kubernetes=k8s
Terraform
Ansible
Helm
Jenkins
GitHub Actions
GitLab CI
CI/CD=ci cd,continuous integration,continuous delivery,continuous deployment
DevOps
SRE=site reliability
Linux
Unix
Nginx
Serverless
AWS Lambda=lambda functions
Microservices=microservice
Distributed Systems=distributed system
System Design=systems design
Kafka=apache kafka
RabbitMQ
Redis
Elasticsearch=elastic search,opensearch
PostgreSQL=postgres,psql
MySQL
MongoDB=mongo
DynamoDB
Cassandra
Oracle
SQL Server=mssql
SQLite
Snowflake
BigQuery
Redshift
Databricks
Spark=apache spark,pyspark
Hadoop
Airflow=apache airflow
dbt
ETL=elt,data pipelines,data pipeline
Data Warehouse=data warehousing
Data Modeling=data modelling
Data Engineering
Data Analysis=data analytics
Data Science
Data Visualization=data viz
Statistics=statistical analysis
A/B Testing=ab testing,a/b tests,experimentation
Machine Learning=ml
Deep Learning
NLP=natural language processing
Computer Vision
LLM=llms,large language models
Generative AI=genai,gen ai
Prompt Engineering
RAG=retrieval augmented generation
PyTorch
TensorFlow
scikit-learn=sklearn
Pandas
NumPy
MLOps
Tableau
Power BI=powerbi
Looker
Microsoft Excel=ms excel,advanced excel,excel spreadsheets,spreadsheets
Google Analytics=ga4
SEO=search engine optimization
SEM
PPC
Content Marketing
Email Marketing
Social Media
Marketing Automation
HubSpot
Marketo
Salesforce=sfdc
Copywriting
Brand Management=branding
Growth Marketing=growth hacking
Product Marketing
Market Research
Competitive Analysis
Agile=agile methodology
Scrum
Kanban
Jira
Confluence
Product Management
Product Strategy
Product Roadmap=roadmapping,roadmap
Product Discovery
User Stories
Requirements Gathering
Business Analysis=business analyst
Project Management
Program Management
Stakeholder Management=stakeholder engagement,stakeholder communication
Risk Management
Change Management
Vendor Management
Budgeting=budget management
Forecasting
Financial Modeling=financial modelling
Financial Analysis
FP&A
Accounting
Auditing
GAAP
Bookkeeping
QuickBooks
SAP
NetSuite
Procurement
Supply Chain
Logistics
Operations Management
Process Improvement=process optimization
Lean
Six Sigma
KPIs=kpi,key performance indicators
OKRs=okr
Sales
B2B
B2C
SaaS
Enterprise Sales
Account Management
Account Executive
Business Development
Lead Generation
Cold Calling
Prospecting
Negotiation
Pipeline Management
CRM
Customer Success
Customer Support=customer service
Customer Experience
Onboarding
Retention
Churn
Upselling=upsell,cross-selling
Recruiting=recruitment,talent acquisition
Sourcing
HRIS
Workday
Employee Engagement
Performance Management
Compensation and Benefits=compensation,benefits administration
Training=learning and development
Figma
Sketch
Adobe XD
Photoshop
Illustrator
UX Design=ux,user experience
UI Design=ui,user interface
User Research
Usability Testing
Wireframing=wireframes
Prototyping=prototypes
Design Systems=design system
Accessibility=wcag,a11y
Responsive Design
Interaction Design
Visual Design
Graphic Design
Motion Graphics
Video Editing
Technical Writing
Content Creation
Content Strategy
Editing=proofreading
Public Speaking
Presentation Skills=presentations
Git
GitHub
Bitbucket
Unit Testing
Integration Testing
Test Automation=automated testing
Selenium
Cypress
Playwright
Jest
QA=quality assurance
TDD=test driven development
Code Review=code reviews
API Design
API Development
Cybersecurity=information security,infosec
Penetration Testing=pentesting
OAuth
SSO=single sign-on
IAM
Compliance
SOC 2=soc2
GDPR
HIPAA
ISO 27001
Networking
Observability
Monitoring
Prometheus
Grafana
Datadog
Splunk
Embedded Systems
IoT
Blockchain
Solidity
Game Development
Unity
Unreal Engine
Mobile Development
Web Development
Full Stack=fullstack,full-stack
Backend=back-end,back end
Frontend=front-end,front end
Cloud Computing
Performance Optimization=performance tuning
Technical Leadership=tech lead
Mentoring=mentorship,coaching
People Management=team management,managing teams,team leadership
Leadership
Communication=communication skills
Collaboration=cross-functional,teamwork
Problem Solving=problem-solving
Critical Thinking
Analytical Skills=analytical thinking
Strategic Thinking=strategic planning
Decision Making
Time Management
Adaptability
Attention to Detail=detail-oriented,detail oriented
Creativity
Self-motivated=self motivated,self-starter
Conflict Resolution
Emotional Intelligence
Customer Focus=customer-focused
Ownership
`;

const acronymStoplist = new Set(
  "AND THE FOR WITH YOU OUR ARE NOT USA US UK EU EEO EOE LLC INC LTD CEO CFO CTO COO VP HR OK PM AM FAQ ETC PDF PTO ASAP FTE WFH MBA BA BS MS PHD DEI LGBTQ ID II III IV TBD TBA NA CV".split(" "),
);

interface Skill {
  name: string;
  pattern: RegExp;
}

const skills: Skill[] = dictionary
  .trim()
  .split("\n")
  .map((line) => {
    const [name = "", aliases = ""] = line.split("=");
    return { name, pattern: termPattern([name, ...aliases.split(",").filter(Boolean)]) };
  });

function termPattern(terms: string[]): RegExp {
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&").replace(/\s+/g, "\\s+"));
  // lookarounds instead of \b so that "C++", "C#" and ".NET" work
  return new RegExp(`(?<![\\p{L}\\p{N}+#.])(?:${escaped.join("|")})(?![\\p{L}\\p{N}+#]|\\.[\\p{L}\\p{N}])`, "iu");
}

export function skillsIn(text: string): string[] {
  const found = skills.filter((skill) => skill.pattern.test(text)).map((skill) => skill.name);
  const acronyms = (text.match(/\b[A-Z][A-Z0-9]{1,5}\b/g) ?? []).filter((word) => !acronymStoplist.has(word) && !/^\d/.test(word));
  return dedupe([...found, ...acronyms.filter((word) => !found.some((name) => name.toLowerCase() === word.toLowerCase()))]);
}

export function isKnown(name: string): boolean {
  return skills.some((skill) => skill.name === name);
}

/** A fresh global copy for finding every occurrence; the shared patterns stay non-global so test() keeps no state. */
export function finder(name: string): RegExp {
  const pattern = skills.find((skill) => skill.name === name)?.pattern ?? termPattern([name]);
  return new RegExp(pattern.source, `${pattern.flags}g`);
}

/** Is this skill (dictionary name or bare acronym) present in the candidate text? */
export function hasSkill(name: string, candidateText: string): boolean {
  const known = skills.find((skill) => skill.name === name);
  const pattern = known?.pattern ?? termPattern([name]);
  return pattern.test(candidateText);
}
