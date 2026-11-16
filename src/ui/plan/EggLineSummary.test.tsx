import {render,screen} from '@testing-library/react';
import {expect,test} from 'vitest';
import {EggLineSummary} from './EggLineSummary';

test('a peer sees the shared parent portraits and natures without the owner full snapshot',()=>{
  render(<EggLineSummary line={{eggGameId:3227,nature:'固执',body:'大块头',voice:'婉转声',gameAccountKey:'uid:2',motherId:'m',fatherId:'f',greenParentId:'f',
    parents:[{id:'m',gameId:3227,name:'菊花梨',nature:'保守',body:'大块头',voice:'婉转声'},{id:'f',gameId:3436,name:'柴渣虫',nature:'固执',body:'大块头',voice:'+100'}]}}/>);
  expect(screen.getByText('菊花梨')).toBeTruthy();expect(screen.getByText('柴渣虫')).toBeTruthy();
  expect(screen.getByText('保守')).toBeTruthy();expect(screen.getByRole('img',{name:'进学院小窝'})).toBeTruthy();
});

test('production percentages name nature instead of implying guaranteed body and voice',()=>{
 render(<EggLineSummary line={{eggGameId:3227,nature:'固执',body:'满体重',voice:'婉转声',gameAccountKey:'uid:2',motherId:'m',fatherId:'f',natureChance:0.5}}/>);
 expect(screen.getByText(/性格 50%/)).toBeTruthy();
});
