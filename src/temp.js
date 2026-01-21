import executor from './utils/codeExecutor/executor.js'
const stressTests = [
  {
    id: 1,
    name: "infinite loop",
    code: `
#include <bits/stdc++.h>
using namespace std;
int main(){ while(true){} }
`
  },
  {
    id: 2,
    name: "infinite output",
    code: `
#include <bits/stdc++.h>
using namespace std;
int main(){ while(true) cout<<"SPAM\\n"; }
`
  },
  {
    id: 3,
    name: "too much output (finite)",
    code: `
#include <bits/stdc++.h>
using namespace std;
int main(){
  for(long long i=0;i<100000000;i++) cout<<i<<"\\n";
}
`
  },
  {
    id: 4,
    name: "infinite recursion",
    code: `
#include <bits/stdc++.h>
using namespace std;
void f(){ f(); }
int main(){ f(); }
`
  },
  {
    id: 5,
    name: "deep recursion",
    code: `
#include <bits/stdc++.h>
using namespace std;
void f(int d){ if(!d) return; f(d-1); }
int main(){ f(1000000); }
`
  },
  {
    id: 6,
    name: "infinite memory",
    code: `
#include <bits/stdc++.h>
using namespace std;
int main(){
  vector<string> v;
  while(true) v.push_back(string(1000000,'A'));
}
`
  },
  {
    id: 7,
    name: "cpu burn",
    code: `
#include <bits/stdc++.h>
using namespace std;
int main(){
  volatile long long x=0;
  while(true) x++;
}
`
  },
  {
    id: 8,
    name: "cpu + output",
    code: `
#include <bits/stdc++.h>
using namespace std;
int main(){
  while(true){
    for(int i=0;i<100000;i++) cout<<"X\\n";
  }
}
`
  },
  {
    id: 9,
    name: "fork bomb (sandbox only)",
    code: `
#include <unistd.h>
int main(){
  while(true) fork();
}
`
  }
];


stressTests.forEach(async(ele) => {

    const res  = await executor(ele.code,ele.input);
    
    const obj  = {...res , "name":ele.name};
    console.log(obj);
    
});

