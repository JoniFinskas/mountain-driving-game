export function createProgress(){
  const records=new Map();
  return {
    getItem(key){return records.get(key)??null;},
    setItem(key,value){records.set(key,value);},
  };
}
