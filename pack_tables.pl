#!/usr/bin/perl -w

if ( $#ARGV < 0 || $ARGV[0] eq "-h" )
{
    print "\n   pack_tables.pl <out-file> <eccode-table-dir> <wmo-vers> <loc-tab ...>\n\n";
    print "      loc-tab= local-version/center/subcenter\n\n";
    exit;
}
$fnout  = shift;
$tabdir = shift;
$verswmo = shift;
@versloc = @ARGV;

open OUT, "> $fnout" or die $@;

sub parse {
	$path = shift;
	print "Parsing in $path ...\n";
	print OUT "\"elements\":{\n";
	open IN, "$path/element.table" or die $@;
	%max_width = ();
	$i = 0;
	while ( defined( $line = <IN> ) )
	{
	    next if ( $line =~ /#/ );
        chomp $line;
	    @le = split /\|/, $line;    #/
	    print OUT ( $i ? ",\n" : "" )
	      . "\"$le[0]\":"
	      . "{\"snam\":\""
	      . $le[1]
	      . "\",\"type\":\""
	      . $le[2]
	      . "\",\"name\":\""
	      . $le[3]
	      . "\",\"unit\":\""
	      . $le[4]
	      . "\",\"scale\":"
	      . $le[5]
	      . ",\"ref\":"
	      . $le[6]
	      . ",\"width\":"
	      . $le[7] . "}";
	    $i++;
	    if (not exists $max_width{$le[2]} or $le[7] > $max_width{$le[2]})
	    {
	    	$max_width{$le[2]} = $le[7];
	    }
	}
	close IN;
	print "Max bit width:\n";
	foreach $key (keys %max_width)
	{
		print $key,":",$max_width{$key},"\n";
	}
	print OUT "},\n\"sequence\":{\n";
	open IN, "$path/sequence.def" or die $@;
	$i   = 0;
	$buf = "";
	foreach $line (<IN>)
	{
	    next if ( $line =~ /^#/ );
	    $buf .= $line;
	    if ( $buf =~ /]$/ )
	    {
	        $buf =~ s/\s+//g;
	        $buf =~ /^("\d{6}")=\[([0-9,]+)]/;
	        $desc = $1;
	        @seq  = split /,/, $2;
	        print OUT ( $i ? ",\n" : "" ) . "$desc:[";
	        $j = 0;
	        foreach $d (@seq)
	        {
	            print OUT ( $j ? "," : "" ) . "\"$d\"";
	            $j++;
	        }
	        print OUT "]";
	        $i++;
	        $buf = "";
	    }
	}
	close IN;
	print OUT "},\n\"codetables\":{\n";
	$i = 0;
	foreach $fn ( glob "$path/codetables/*.table" )
	{
	    $fn =~ /.*\/(\d+)\.table/;
	    $desc = $1;
	    printf OUT ( $i ? ",\n" : "" ) . "\"%06d\": {", $desc;
	    %buf = ();
	    open IN, $fn or die $@;
	    foreach $line (<IN>)
	    {
	        next if ( $line =~ /^#/ );
	        chomp $line;
	        $line =~ s/\s{2,}/ /g;
	        $line =~ s/""/'/g;
            $line =~ s/"/'/g;
	        @le = split / /, $line, 3;
	        $buf{ $le[0] } = $le[2];
	        $i++;
	    }
	    close IN;
	    $j = 0;
	    foreach $v ( sort keys %buf )
	    {
	        print OUT ( $j ? "," : "" ) . "\"$v\":\"" . $buf{$v} . "\"";
	        $j++;
	    }
	    print OUT "}";
	    $i++;
	}
	print OUT "\n}\n";
}

print OUT "{\"wmo\":{\n";
parse "$tabdir/0/wmo/$verswmo";

print OUT "},\n\"local\":{";
$l = 0;
foreach $loc (@versloc)
{
    print OUT (($l > 0) ? ",\n":"\n")."\"$loc\":{\n";
    parse "$tabdir/0/local/$loc";
    print OUT "}";
    $l++;
}

print OUT "\n}\n}\n";
close OUT;
__END__
