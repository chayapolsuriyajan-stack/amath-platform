import { Link } from 'react-router-dom';
import { FACE_ORDER, TILE_SET, TOTAL_TILES } from '@amath/shared';

export function Rules() {
  return (
    <div className="page">
      <article className="doc">
        <h1>Basic Rules</h1>

        <h2>Equations</h2>
        <p>Only a minus sign may go in front of a number, and never in front of zero. A plus sign can’t lead an equation.</p>
        <pre>{'-6 = 4 - 10\n-5 = -5\n+7 = 5 + 2   ✗\n6 + -13 = -7   ✗'}</pre>
        <p>Only 3 digits can be concatenated.</p>
        <pre>{'123 = 100 + 23\n1234 = 1000 + 234   ✗'}</pre>
        <p>Zero left padding is not a valid value.</p>
        <pre>{'012 = 011 + 1   ✗'}</pre>

        <h2>Junior Edition tiles</h2>
        <p>
          This is the <b>Junior Edition</b> set: {TOTAL_TILES} tiles. The only two-digit tiles are{' '}
          <b>10, 11, 12, 13, 14, 15, 16</b> and a separate <b>20</b>. There are no 17, 18 or 19 tiles.
          Each of these tiles is one whole number: it can never be joined to another digit, so a 1 next to a 12 tile is not 112.
          Single digits (0–9) still join into numbers of up to 3 digits.
        </p>
        <p>
          There are no separate × and ÷ tiles either. Multiplication and division both come from the <b>×/÷</b> tile, and you
          choose which one it is when you place it. The same goes for <b>+/-</b>.
        </p>

        <h2>The clock</h2>
        <p>
          Each player has one clock for the whole match, <b>20:00</b> by default. The player who creates the room sets it to any
          time in minutes:seconds, or switches it off. Your clock only runs while it is your turn and stops as soon as you play,
          so how you spend the time across your turns is up to you.
        </p>
        <p>
          It keeps counting once it passes zero and turns red. If you go <b>5 minutes past zero</b>, you lose the game, even if
          you have walked away from the board.
        </p>

        <h2>Placing tiles</h2>
        <p>
          The first move must cover the ★ square, and the tile you put there is worth <b>three times</b> its value. Every later
          move must connect to tiles on the board. Every line of two or more tiles that you form, across and down, must be a valid
          equation. Multiplication and division are done before addition and subtraction, and an equation can have more than one
          = sign as long as every side is equal.
        </p>
        <p>
          A +/- or ×/÷ tile becomes one of its two operators when you place it. A blank tile can be any number tile, operator or =.
        </p>

        <h2>Points</h2>
        <p>There are four types of multiplier.</p>
        <ul>
          <li>x2 for piece</li>
          <li>x3 for piece</li>
          <li>x2 for equation</li>
          <li>x3 for equation</li>
        </ul>
        <p>Piece multipliers only apply to tiles placed this turn. Successfully submitting all 8 items will gain +40 extra points.</p>

        <h2>Who starts</h2>
        <p>
          Each player draws one tile, and whoever draws nearest to 20 goes first. Symbol tiles all count the same and lowest, a
          blank counts highest, and a tie means both draw again. The tiles go back in the bag before the game begins.
        </p>

        <h2>Exchange and pass</h2>
        <p>
          You can exchange tiles while there are at least 5 tiles in the bag; it uses your turn. Once fewer than 5 are left and
          exchanging is no longer possible, you can pass instead.
        </p>

        <h2>Playing the computer</h2>
        <p>
          <b>Easy</b> plays short, simple equations of up to 5 tiles and never uses a blank. <b>Medium</b> plays solid moves of up
          to 6 tiles. <b>Hard</b> searches for the highest-scoring move each turn, using all 8 tiles and blanks when they are worth
          it. The computer follows exactly the same rules and clock as you, and never sees your tiles.
        </p>

        <h2>End game</h2>
        <p>There are two ways of ending game.</p>
        <ol>
          <li>Ran out of both common items in the bag and one’s deck items. That player adds double the value of the other player’s remaining tiles.</li>
          <li>Continually passed the game 3 times by each player. Each player loses the value of their remaining tiles.</li>
        </ol>

        <h2>Multiplayer and history</h2>
        <p>
          Start a new game to get a 6-digit room code and send it to one friend. Finished games are saved in this browser only.
        </p>

        <h2>Tiles ({TOTAL_TILES})</h2>
        <table className="tiles-table">
          <thead>
            <tr><th>Tile</th><th>Count</th><th>Points</th></tr>
          </thead>
          <tbody>
            {FACE_ORDER.map((f) => (
              <tr key={f}><td>{f === '?' ? 'Blank' : f}</td><td>{TILE_SET[f][0]}</td><td>{TILE_SET[f][1]}</td></tr>
            ))}
          </tbody>
        </table>

        <p><Link className="btn" to="/">Back</Link></p>
      </article>
    </div>
  );
}
