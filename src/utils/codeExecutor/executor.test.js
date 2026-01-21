import { describe, test, expect } from "@jest/globals";
import executor from "./executor.js";

const stressTests = [
  {
    name: "infinite loop",
    code: `
#include <bits/stdc++.h>
using namespace std;
int main(){ while(true){} }
`,
    status: "timeout"
  },
  {
    name: "infinite output",
    code: `
#include <bits/stdc++.h>
using namespace std;
int main(){ while(true) cout<<"SPAM\\n"; }
`,
    status: "output_limit_exceeded"
  },
  {
    name: "too much output (finite)",
    code: `
#include <bits/stdc++.h>
using namespace std;
int main(){
  for(long long i=0;i<100000000;i++) cout<<i<<"\\n";
}
`,
    status: "output_limit_exceeded"
  },
  {
    name: "infinite recursion",
    code: `
#include <bits/stdc++.h>
using namespace std;
void f(){ f(); }
int main(){ f(); }
`,
    status: "timeout"
  },
  {
    name: "deep recursion",
    code: `
#include <bits/stdc++.h>
using namespace std;
void f(int d){ if(!d) return; f(d-1); }
int main(){ f(1000000); }
`,
    status: "success"
  },
  {
    name: "infinite memory",
    code: `
#include <bits/stdc++.h>
using namespace std;
int main(){
  vector<string> v;
  while(true) v.push_back(string(1000000,'A'));
}
`,
    status: "runtime_error"
  },
  {
    name: "cpu burn",
    code: `
#include <bits/stdc++.h>
using namespace std;
int main(){
  volatile long long x=0;
  while(true) x++;
}
`,
    status: "timeout"
  },
  {
    name: "cpu + output",
    code: `
#include <bits/stdc++.h>
using namespace std;
int main(){
  while(true){
    for(int i=0;i<100000;i++) cout<<"X\\n";
  }
}
`,
    status: "output_limit_exceeded"
  },
  {
    name: "fork bomb (sandbox only)",
    code: `
#include <unistd.h>
int main(){
  while(true) fork();
}
`,
    status: "timeout"
  }
];

describe("executor status matching", () => {
  stressTests.forEach(({ name, code, status }) => {
    test(name, async () => {
      const res = await executor(code, "");

      expect(res.status).toBe(status);

      if (status === "success") {
        expect(res.stdout).toBe("");
        expect(res.exit_code).toBe(0);
      }
    });
  });
});