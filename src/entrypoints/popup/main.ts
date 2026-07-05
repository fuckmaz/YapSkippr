import './style.css';

document.querySelector('#status')?.replaceChildren(
  document.createTextNode('Detection logs are shown in the YouTube tab console for V1.')
);
